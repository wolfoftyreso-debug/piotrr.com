import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  createClamAvScanner,
  frameChunk,
  INSTREAM_END,
  parseClamdReply,
} from "./scanner";

/**
 * A stand-in for clamd: accepts one INSTREAM conversation, records exactly
 * what the client sent, and answers with the given line. Lets the protocol
 * be tested for real — sockets and framing included — without a daemon.
 */
function fakeClamd(reply: string) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      received.push(chunk);
      const all = Buffer.concat(received);
      // The conversation ends with the four-zero-byte terminator.
      if (all.length >= 4 && all.subarray(-4).equals(INSTREAM_END)) {
        socket.write(reply);
      }
    });
  });
  const ready = new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
  return {
    ready,
    close: () => new Promise<void>((r) => server.close(() => r())),
    sent: () => Buffer.concat(received),
  };
}

async function* bytes(...parts: string[]) {
  for (const p of parts) yield new Uint8Array(Buffer.from(p));
}

describe("clamd reply parsing", () => {
  it("reads a clean verdict", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ verdict: "clean" });
  });

  it("reads the signature name out of a detection", () => {
    expect(parseClamdReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      verdict: "infected",
      detail: "Eicar-Test-Signature",
    });
  });

  it("treats a daemon error as an error, not a pass", () => {
    const result = parseClamdReply("INSTREAM size limit exceeded. ERROR\0");
    expect(result.verdict).toBe("error");
    expect(result.detail).toContain("size limit");
  });

  it("never reads an unrecognised reply as clean", () => {
    expect(parseClamdReply("").verdict).toBe("error");
    expect(parseClamdReply("something unexpected").verdict).toBe("error");
  });

  it("tolerates newline-terminated replies", () => {
    expect(parseClamdReply("stream: OK\n")).toEqual({ verdict: "clean" });
  });
});

describe("INSTREAM framing", () => {
  it("prefixes each chunk with its big-endian length", () => {
    const framed = frameChunk(new Uint8Array([1, 2, 3]));
    expect(framed.readUInt32BE(0)).toBe(3);
    expect([...framed.subarray(4)]).toEqual([1, 2, 3]);
  });

  it("terminates the stream with four zero bytes", () => {
    expect(INSTREAM_END.byteLength).toBe(4);
    expect(INSTREAM_END.readUInt32BE(0)).toBe(0);
  });
});

describe("clamd conversation over a real socket", () => {
  it("opens with zINSTREAM and streams the framed body", async () => {
    const daemon = fakeClamd("stream: OK\0");
    const port = await daemon.ready;
    const scanner = createClamAvScanner("127.0.0.1", port);

    const result = await scanner.scan(bytes("hello ", "world"));
    expect(result).toEqual({ verdict: "clean" });

    const wire = daemon.sent();
    expect(wire.subarray(0, 10).toString()).toBe("zINSTREAM\0");
    // Two chunks, each length-prefixed, then the terminator.
    expect(wire.readUInt32BE(10)).toBe(6);
    expect(wire.subarray(14, 20).toString()).toBe("hello ");
    expect(wire.readUInt32BE(20)).toBe(5);
    expect(wire.subarray(24, 29).toString()).toBe("world");
    expect(wire.subarray(-4).equals(INSTREAM_END)).toBe(true);

    await daemon.close();
  });

  it("reports a detection as infected", async () => {
    const daemon = fakeClamd("stream: Eicar-Test-Signature FOUND\0");
    const scanner = createClamAvScanner("127.0.0.1", await daemon.ready);

    const result = await scanner.scan(bytes("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"));
    expect(result.verdict).toBe("infected");
    expect(result.detail).toBe("Eicar-Test-Signature");

    await daemon.close();
  });

  it("errors — never passes — when the daemon is unreachable", async () => {
    // Port 1 is not listening; connect fails immediately.
    const scanner = createClamAvScanner("127.0.0.1", 1, 1024, 2000);
    const result = await scanner.scan(bytes("anything"));
    expect(result.verdict).toBe("error");
  });

  it("refuses a body larger than the scan limit instead of passing it", async () => {
    const daemon = fakeClamd("stream: OK\0");
    const scanner = createClamAvScanner("127.0.0.1", await daemon.ready, 8);

    const result = await scanner.scan(bytes("0123456789"));
    expect(result.verdict).toBe("error");
    expect(result.detail).toContain("exceeds scan limit");

    await daemon.close();
  });
});
