import { headers } from "next/headers";

/**
 * The correlation id for the current request.
 *
 * `audit_events` has carried a `request_id` column since the first
 * migration and nothing ever filled it: the value existed in the schema,
 * in the service signatures, and nowhere in between. So an auditor could
 * see *that* a company was verified but could not tie it to the request
 * that did it, and a support ticket could not be joined to its log lines.
 *
 * The middleware stamps `x-request-id` on every request (honouring one
 * from a trusted proxy so a trace survives the hop) and echoes it on the
 * response, which is what makes a user-reported id searchable.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Whether an inbound id is worth honouring.
 *
 * The header is client-writable, and it used to be trusted verbatim: a
 * request with `X-Request-Id: "><script>…` got that string echoed on the
 * response and written into `audit_events.request_id` and every log line
 * — the legally-sensitive audit trail, polluted with attacker-chosen
 * bytes, and forensics muddied by anyone stamping someone else's id.
 * Measured, not hypothesised.
 *
 * So: an id is honoured only if it looks like an id. Everything else is
 * replaced with a fresh UUID — the trace from a well-behaved proxy still
 * survives the hop, which is the only reason inbound ids are read at all.
 */
export function acceptableRequestId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._-]{8,128}$/.test(value);
}

export async function currentRequestId(): Promise<string | undefined> {
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER);
    return acceptableRequestId(value) ? value : undefined;
  } catch {
    // Outside a request scope (jobs, scripts, tests) there is no id, and
    // that is a legitimate answer rather than an error.
    return undefined;
  }
}
