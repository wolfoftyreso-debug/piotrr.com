import {
  handleApiError,
  parseBody,
  readJsonBody,
  requireApiActor,
  withIdempotency,
} from "@/lib/api";
import { uploadRequestSchema } from "@/lib/api-schemas";
import { requestUpload } from "@/modules/documents/service";

export const dynamic = "force-dynamic";

/**
 * Step 1 of an evidence upload as a client-neutral endpoint: mint a
 * presigned PUT (expires ≤ 15 min). The target company is resolved
 * server-side from the actor — a supplier can only upload into their own
 * company — so the response hands back the document id to confirm once the
 * PUT completes.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor("documents:write");
    const input = parseBody(uploadRequestSchema, await readJsonBody(request));

    return await withIdempotency(request, input, async () => {
      const { document, uploadUrl } = await requestUpload(actor, input);
      return {
        status: 201,
        body: { data: { documentId: document.id, uploadUrl } },
      };
    }, actor.userId);
  } catch (error) {
    return handleApiError(error);
  }
}
