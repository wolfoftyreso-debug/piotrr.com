import net from "node:net";
import { env } from "@/lib/env";

/**
 * Malware scanning for the documents bucket (Section 4.7).
 *
 * GuardDuty Malware Protection for S3 does not exist in the self-owned
 * MinIO setup (Appendix B), so the scan runs against a ClamAV daemon we
 * operate ourselves. Both live behind one interface so managed mode stays
 * a config change away.
 */

export type ScanVerdict = "clean" | "infected" | "error";

export interface ScanResult {
  verdict: ScanVerdict;
  /** Signature name when infected, or the daemon's message when errored */
  detail?: string;
}

export interface MalwareScanner {
  readonly name: string;
  scan(body: AsyncIterable<Uint8Array>): Promise<ScanResult>;
}

/**
 * Parse a clamd reply. INSTREAM answers with a single NUL- or
 * newline-terminated line:
 *
 *   stream: OK
 *   stream: Eicar-Test-Signature FOUND
 *   INSTREAM size limit exceeded. ERROR
 */
export function parseClamdReply(raw: string): ScanResult {
  const line = raw.replace(/\0/g, "").trim();
  if (/\bERROR$/.test(line)) return { verdict: "error", detail: line };
  if (/\bFOUND$/.test(line)) {
    const detail = line.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "");
    return { verdict: "infected", detail: detail || "unknown signature" };
  }
  if (/\bOK$/.test(line)) return { verdict: "clean" };
  return { verdict: "error", detail: line || "empty reply from clamd" };
}

/** Frame one INSTREAM chunk: 4-byte big-endian length, then the bytes. */
export function frameChunk(chunk: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.byteLength, 0);
  return Buffer.concat([header, Buffer.from(chunk)]);
}

/** The terminator clamd expects after the last chunk. */
export const INSTREAM_END = Buffer.alloc(4); // four zero bytes

class ClamAvScanner implements MalwareScanner {
  readonly name = "clamav";

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly maxBytes: number,
    private readonly timeoutMs: number,
  ) {}

  async scan(body: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    const socket = net.createConnection({ host: this.host, port: this.port });
    socket.setTimeout(this.timeoutMs);

    const reply = new Promise<ScanResult>((resolve) => {
      let buffered = "";
      socket.on("data", (d) => {
        buffered += d.toString("utf8");
        if (buffered.includes("\0") || buffered.includes("\n")) {
          resolve(parseClamdReply(buffered));
          socket.end();
        }
      });
      socket.on("timeout", () => {
        resolve({ verdict: "error", detail: "clamd timed out" });
        socket.destroy();
      });
      socket.on("error", (e) =>
        resolve({ verdict: "error", detail: `clamd unreachable: ${e.message}` }),
      );
      socket.on("close", () => resolve({ verdict: "error", detail: "clamd closed the connection" }));
    });

    try {
      await once(socket, "connect");
      await write(socket, Buffer.from("zINSTREAM\0"));

      let sent = 0;
      for await (const chunk of body) {
        sent += chunk.byteLength;
        if (sent > this.maxBytes) {
          socket.destroy();
          return { verdict: "error", detail: `file exceeds scan limit (${this.maxBytes} bytes)` };
        }
        await write(socket, frameChunk(chunk));
      }
      await write(socket, INSTREAM_END);
    } catch (error) {
      socket.destroy();
      return {
        verdict: "error",
        detail: error instanceof Error ? error.message : "stream failed",
      };
    }

    return reply;
  }
}

/** Build a clamd client directly — used by the protocol tests. */
export function createClamAvScanner(
  host: string,
  port: number,
  maxBytes = 64 * 1024 * 1024,
  timeoutMs = 60_000,
): MalwareScanner {
  return new ClamAvScanner(host, port, maxBytes, timeoutMs);
}

/** Dev and test default: no daemon to talk to, nothing is quarantined. */
class NoopScanner implements MalwareScanner {
  readonly name = "noop";
  async scan(body: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    for await (const _chunk of body) void _chunk; // drain so callers can close the stream
    return { verdict: "clean" };
  }
}

function once(socket: net.Socket, event: "connect"): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once("error", reject);
  });
}

function write(socket: net.Socket, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(buf, (error) => (error ? reject(error) : resolve()));
  });
}

let cached: MalwareScanner | undefined;

export function malwareScanner(): MalwareScanner {
  if (!cached) {
    cached =
      env.MALWARE_SCANNER === "clamav"
        ? new ClamAvScanner(
            env.CLAMAV_HOST,
            env.CLAMAV_PORT,
            env.CLAMAV_MAX_BYTES,
            env.CLAMAV_TIMEOUT_MS,
          )
        : new NoopScanner();
  }
  return cached;
}

/** Test seam — lets a suite install a fake without touching the environment. */
export function setMalwareScanner(scanner: MalwareScanner | undefined): void {
  cached = scanner;
}
