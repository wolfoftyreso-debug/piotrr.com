import {
  handleApiError,
  parseBody,
  readJsonBody,
  requireApiActor,
  withIdempotency,
} from "@/lib/api";
import { openCaseSchema } from "@/lib/api-schemas";
import { openCase } from "@/modules/verification/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor("verification:write");
    const input = parseBody(openCaseSchema, await readJsonBody(request));

    return withIdempotency(request, input, async () => {
      const created = await openCase(actor, input);
      return { status: 201, body: { data: created } };
    }, actor.userId);
  } catch (error) {
    return handleApiError(error);
  }
}
