import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildMimeMessage, sendSmtp } from "./smtp";

/** In-process fake SMTP server (plaintext, no STARTTLS) capturing the session. */
function startFakeSmtp(): Promise<{
  server: Server;
  port: number;
  commands: string[];
  data: () => string;
}> {
  const commands: string[] = [];
  let dataBuffer = "";
  const server = createServer((socket: Socket) => {
    let inData = false;
    socket.write("220 fake.local ESMTP\r\n");
    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (inData) {
        dataBuffer += text;
        if (dataBuffer.includes("\r\n.\r\n")) {
          inData = false;
          socket.write("250 OK queued\r\n");
        }
        return;
      }
      for (const line of text.split("\r\n").filter((l) => l.length > 0)) {
        commands.push(line);
        if (line.startsWith("EHLO")) {
          socket.write("250-fake.local greets you\r\n250 8BITMIME\r\n");
        } else if (line.startsWith("MAIL FROM")) {
          socket.write("250 OK\r\n");
        } else if (line.startsWith("RCPT TO")) {
          socket.write(
            line.includes("reject@") ? "550 no such user\r\n" : "250 OK\r\n",
          );
        } else if (line === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("500 unknown\r\n");
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, commands, data: () => dataBuffer });
    });
  });
}

describe("sendSmtp", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("delivers a message through the full SMTP dialogue", async () => {
    const fake = await startFakeSmtp();
    server = fake.server;
    await sendSmtp(
      // Deliberate plaintext (the fake advertises no STARTTLS): opt out of the
      // fail-closed TLS default explicitly, exactly as a dev relay would.
      { host: "127.0.0.1", port: fake.port, secure: false, requireTls: false },
      {
        from: "no-reply@piotrr.example",
        to: "buyer@example.com",
        subject: "Nytt anbud – svetsning",
        text: "Ett anbud har inkommit.\n.starts with a dot",
      },
    );
    expect(fake.commands).toEqual([
      "EHLO piotrr.local",
      "MAIL FROM:<no-reply@piotrr.example>",
      "RCPT TO:<buyer@example.com>",
      "DATA",
      "QUIT",
    ]);
    const data = fake.data();
    // Non-ASCII subject is RFC 2047 encoded
    expect(data).toContain("Subject: =?UTF-8?B?");
    // Leading-dot line is dot-stuffed
    expect(data).toContain("\r\n..starts with a dot");
  });

  it("refuses to send at all over plaintext when TLS is required (the default)", async () => {
    const fake = await startFakeSmtp();
    server = fake.server;
    await expect(
      sendSmtp(
        // No requireTls override, no credentials: the fail-closed default
        // must refuse rather than send a sign-in token over plaintext.
        { host: "127.0.0.1", port: fake.port, secure: false },
        {
          from: "no-reply@piotrr.example",
          to: "buyer@example.com",
          subject: "Din inloggningslänk",
          text: "https://piotrr.example/link?token=secret",
        },
      ),
    ).rejects.toThrow(/not encrypted|refusing to send/);
    // Nothing left the process: no MAIL FROM, so no token on the wire.
    expect(fake.commands.some((c) => c.startsWith("MAIL FROM"))).toBe(false);
  });

  it("refuses AUTH over a plaintext connection without STARTTLS", async () => {
    const fake = await startFakeSmtp();
    server = fake.server;
    await expect(
      sendSmtp(
        {
          host: "127.0.0.1",
          port: fake.port,
          secure: false,
          // Isolate the AUTH-plaintext guard from the fail-closed TLS gate.
          requireTls: false,
          user: "ops",
          password: "secret",
        },
        {
          from: "no-reply@piotrr.example",
          to: "buyer@example.com",
          subject: "x",
          text: "x",
        },
      ),
    ).rejects.toThrow(/refusing to send AUTH/);
    expect(fake.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
  });

  it("fails loudly when the server rejects a recipient", async () => {
    const fake = await startFakeSmtp();
    server = fake.server;
    await expect(
      sendSmtp(
        { host: "127.0.0.1", port: fake.port, secure: false, requireTls: false },
        {
          from: "no-reply@piotrr.example",
          to: "reject@example.com",
          subject: "x",
          text: "x",
        },
      ),
    ).rejects.toThrow(/SMTP command failed \(RCPT/);
  });
});

describe("buildMimeMessage", () => {
  it("builds multipart/alternative when html is present", () => {
    const mime = buildMimeMessage({
      from: "a@x.se",
      to: "b@x.se",
      subject: "Hello",
      text: "plain",
      html: "<p>rich</p>",
    });
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(mime).toContain("plain");
    expect(mime).toContain("<p>rich</p>");
  });

  it("keeps ASCII subjects readable", () => {
    const mime = buildMimeMessage({
      from: "a@x.se",
      to: "b@x.se",
      subject: "Plain subject",
      text: "t",
    });
    expect(mime).toContain("Subject: Plain subject");
  });
});
