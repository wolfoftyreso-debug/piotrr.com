import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * Minimal dependency-free SMTP client for the self-hosted deployment mode
 * (no SES, no third-party mail SaaS — point it at your own relay, e.g. a
 * Postfix container or the org's internal smarthost).
 *
 * Supports: EHLO, STARTTLS (opportunistic; required when credentials are
 * set), AUTH PLAIN, one recipient per send, text + optional HTML body
 * (multipart/alternative). Deliberately nothing more — this is a relay
 * client, not a full MTA.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS from the first byte (typically port 465) */
  secure: boolean;
  /**
   * Refuse to send unless the connection is encrypted (implicit TLS or a
   * completed STARTTLS upgrade). Defaults to true — mail carries sign-in
   * tokens, so plaintext is a fail-closed error, not a silent fallback.
   */
  requireTls?: boolean;
  user?: string;
  password?: string;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const COMMAND_TIMEOUT_MS = 15_000;

class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private waiter: {
    resolve: (reply: { code: number; lines: string[] }) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.tryFlush();
    });
    socket.on("error", (err) => this.waiter?.reject(err));
    socket.on("close", () =>
      this.waiter?.reject(new Error("SMTP connection closed unexpectedly")),
    );
  }

  /** A reply is complete when the last received line is "NNN text" (space,
   * not dash, after the code). Multiline replies use "NNN-text". */
  private tryFlush() {
    if (!this.waiter) return;
    const terminated = this.buffer.endsWith("\r\n");
    if (!terminated) return;
    const lines = this.buffer.split("\r\n").filter((l) => l.length > 0);
    const last = lines[lines.length - 1];
    if (!last || !/^\d{3}( |$)/.test(last)) return;
    this.buffer = "";
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve({ code: parseInt(last.slice(0, 3), 10), lines });
  }

  readReply(): Promise<{ code: number; lines: string[] }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SMTP reply timeout")),
        COMMAND_TIMEOUT_MS,
      );
      this.waiter = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      // A reply may already be fully buffered (e.g. the greeting).
      this.tryFlush();
    });
  }

  async command(line: string, expected: number[]): Promise<string[]> {
    this.socket.write(line + "\r\n");
    const reply = await this.readReply();
    if (!expected.includes(reply.code)) {
      throw new Error(
        `SMTP command failed (${line.split(" ")[0]}): ${reply.lines.join(" / ")}`,
      );
    }
    return reply.lines;
  }

  write(data: string) {
    this.socket.write(data);
  }

  async upgradeToTls(host: string): Promise<void> {
    const plain = this.socket as Socket;
    plain.removeAllListeners("data");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    const tls = await new Promise<TLSSocket>((resolve, reject) => {
      const s = tlsConnect({ socket: plain, servername: host }, () =>
        resolve(s),
      );
      s.once("error", reject);
    });
    this.buffer = "";
    this.socket = tls;
    this.attach(tls);
  }

  end() {
    this.socket.removeAllListeners("close");
    this.socket.end();
  }
}

function encodeHeaderValue(value: string): string {
  // RFC 2047 encoded-word for non-ASCII header values (subjects in sv/lt).
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

export function buildMimeMessage(message: SmtpMessage): string {
  const headers: string[] = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  let body: string;
  if (message.html) {
    const boundary = `bb-${Buffer.from(message.subject).toString("hex").slice(0, 16)}-alt`;
    headers.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    );
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.html,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push('Content-Type: text/plain; charset="utf-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    body = message.text;
  }
  return headers.join("\r\n") + "\r\n\r\n" + dotStuff(body);
}

export async function sendSmtp(
  config: SmtpConfig,
  message: SmtpMessage,
): Promise<void> {
  const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const s = config.secure
      ? tlsConnect({ host: config.host, port: config.port }, () => resolve(s))
      : createConnection({ host: config.host, port: config.port }, () =>
          resolve(s),
        );
    s.once("error", reject);
    s.setTimeout(COMMAND_TIMEOUT_MS, () => {
      s.destroy();
      reject(new Error("SMTP connect timeout"));
    });
  });
  socket.setTimeout(0);

  const conn = new SmtpConnection(socket);
  try {
    const greeting = await conn.readReply();
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.lines.join(" / ")}`);
    }

    let ehlo = await conn.command("EHLO piotrr.local", [250]);
    const advertises = (ext: string) =>
      ehlo.some((l) => l.slice(4).toUpperCase().startsWith(ext));

    let secured = config.secure;
    if (!secured && advertises("STARTTLS")) {
      await conn.command("STARTTLS", [220]);
      await conn.upgradeToTls(config.host);
      secured = true;
      ehlo = await conn.command("EHLO piotrr.local", [250]);
    }

    // Fail closed: a sign-in token must never travel in plaintext. If the
    // relay offered no implicit TLS and no STARTTLS — or an on-path attacker
    // stripped the STARTTLS advertisement — refuse to send at all, not just
    // to AUTH. This holds whether or not credentials are configured.
    if ((config.requireTls ?? true) && !secured) {
      throw new Error(
        "SMTP connection is not encrypted (no implicit TLS and STARTTLS " +
          "unavailable) — refusing to send. Set SMTP_REQUIRE_TLS=false to " +
          "accept plaintext deliberately.",
      );
    }

    if (config.user && config.password) {
      if (!secured) {
        throw new Error(
          "SMTP credentials set but connection is plaintext (no TLS/STARTTLS) — refusing to send AUTH",
        );
      }
      const token = Buffer.from(
        `\u0000${config.user}\u0000${config.password}`,
        "utf8",
      ).toString("base64");
      await conn.command(`AUTH PLAIN ${token}`, [235]);
    }

    await conn.command(`MAIL FROM:<${message.from}>`, [250]);
    await conn.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await conn.command("DATA", [354]);
    conn.write(buildMimeMessage(message) + "\r\n.\r\n");
    const accepted = await conn.readReply();
    if (accepted.code !== 250) {
      throw new Error(`SMTP DATA rejected: ${accepted.lines.join(" / ")}`);
    }
    await conn.command("QUIT", [221]).catch(() => undefined);
  } finally {
    conn.end();
  }
}
