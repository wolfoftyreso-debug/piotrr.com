import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// promisify() resolves to the 3-argument overload, which drops the cost
// options — the whole point here. Wrap it explicitly instead.
function scrypt(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Password hashing — Node stdlib scrypt, no extra dependency
 * (Section 2: every dependency must earn its place).
 *
 * Node's default cost is N=2^14, which is below the current OWASP minimum
 * for scrypt (N=2^17, r=8, p=1). The parameters are therefore explicit and
 * stored *with* the hash, in a versioned format:
 *
 *     scrypt$<N>$<r>$<p>$<salt-hex>$<derived-hex>
 *
 * Storing the cost is what makes it raisable later: verification always
 * uses the parameters the hash was written with, so raising N below only
 * affects new hashes. `needsRehash` reports a hash written under weaker
 * parameters, and the sign-in path rewrites it once the password has been
 * proven correct — the only moment the plaintext is available.
 *
 * The legacy `scrypt:<salt>:<hash>` form (Node defaults) is still read so
 * accounts created before this change keep working; they are rehashed on
 * their next successful sign-in.
 */

const N = 1 << 17; // 131072 — OWASP minimum for scrypt
const R = 8;
const P = 1;
const KEY_LEN = 64;
// scrypt needs roughly 128 * N * r bytes; Node's 32 MB default is not enough.
const MAX_MEM = 256 * 1024 * 1024;

type Params = { n: number; r: number; p: number };

const CURRENT: Params = { n: N, r: R, p: P };

async function derive(
  password: string,
  salt: string,
  { n, r, p }: Params,
): Promise<Buffer> {
  return scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await derive(password, salt, CURRENT);
  return `scrypt$${N}$${R}$${P}$${salt}$${derived.toString("hex")}`;
}

/**
 * A well-formed hash that no password matches, for the "no such account"
 * branch of sign-in. It must carry the *current* parameters: verifying
 * against a cheaper legacy hash would make a missing account measurably
 * faster than a real one, which is the enumeration oracle the dummy
 * verify exists to remove.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${N}$${R}$${P}$${"00".repeat(16)}$${"00".repeat(KEY_LEN)}`;

/** Parse either stored form. Returns null for anything unrecognised. */
function parse(
  stored: string,
): { params: Params; salt: string; hash: string } | null {
  if (stored.startsWith("scrypt$")) {
    const [, n, r, p, salt, hash] = stored.split("$");
    const params = { n: Number(n), r: Number(r), p: Number(p) };
    if (
      !Number.isSafeInteger(params.n) ||
      !Number.isSafeInteger(params.r) ||
      !Number.isSafeInteger(params.p) ||
      params.n < 2 ||
      params.r < 1 ||
      params.p < 1 ||
      // Refuse absurd parameters from a tampered row rather than letting
      // them turn a login into a memory-exhaustion request.
      128 * params.n * params.r > MAX_MEM ||
      !salt ||
      !hash
    ) {
      return null;
    }
    return { params, salt, hash };
  }
  // Legacy: Node's scrypt defaults, colon-separated.
  const [algo, salt, hash] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hash) return null;
  return { params: { n: 16384, r: 8, p: 1 }, salt, hash };
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await derive(password, parsed.salt, parsed.params);
  } catch {
    return false;
  }
  const expected = Buffer.from(parsed.hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * True when the stored hash was written under weaker parameters than the
 * ones in force now. Only meaningful right after a successful verify.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return false;
  return (
    parsed.params.n < CURRENT.n ||
    parsed.params.r < CURRENT.r ||
    parsed.params.p < CURRENT.p
  );
}
