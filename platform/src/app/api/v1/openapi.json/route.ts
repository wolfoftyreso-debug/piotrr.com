import { NextResponse } from "next/server";
import {
  createCompanySchema,
  openCaseSchema,
  sendMessageSchema,
  transitionItemSchema,
  uploadRequestSchema,
} from "@/lib/api-schemas";
import { buildOpenApiDocument } from "@/lib/openapi";
import { registerInputSchema } from "@/modules/identity/service";
import { rfqInputSchema } from "@/modules/rfq/service";
import { offerInputSchema } from "@/modules/offers/service";

export const dynamic = "force-dynamic";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

/** Machine-readable API contract, generated from the live Zod schemas. */
export async function GET() {
  return NextResponse.json(
    buildOpenApiDocument(
      {
        createCompany: createCompanySchema,
        register: registerInputSchema,
        rfq: rfqInputSchema,
        openCase: openCaseSchema,
        transitionItem: transitionItemSchema,
        submitOffer: offerInputSchema,
        sendMessage: sendMessageSchema,
        requestUpload: uploadRequestSchema,
      },
      BASE_URL,
    ),
  );
}
