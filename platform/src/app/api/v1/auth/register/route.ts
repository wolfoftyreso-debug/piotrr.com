import { apiError, handleApiError, parseBody, readJsonBody, withIdempotency } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  EmailTakenError,
  registerInputSchema,
  registerUser,
} from "@/modules/identity/service";

export const dynamic = "force-dynamic";

/**
 * Public self-serve registration (buyer or supplier). Rate limited
 * (Section 4.7) and idempotent (Section 4.5).
 */
export async function POST(request: Request) {
  const ip =
    clientIp(request.headers);
  const limited = rateLimit(`register:${ip}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return apiError(429, "Too many registration attempts — try again later");
  }

  try {
    const input = parseBody(registerInputSchema, await readJsonBody(request));
    return await withIdempotency(request, { email: input.email }, async () => {
      try {
        const user = await registerUser(input);
        return {
          status: 201,
          body: {
            data: { id: user.id, email: user.email, role: user.role },
          },
        };
      } catch (error) {
        if (error instanceof EmailTakenError) {
          return { status: 409, body: { error: { message: error.message } } };
        }
        throw error;
      }
    }, `anon:${ip}`);
  } catch (error) {
    return handleApiError(error);
  }
}
