"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  requestUploadUrlAction,
  submitItemEvidenceAction,
} from "./actions";

/**
 * Evidence upload for a verification requirement:
 * presigned PUT to the private documents bucket, then submit for review.
 */
export default function UploadEvidence({
  itemId,
  documentType,
}: {
  itemId: string;
  documentType: string;
}) {
  const t = useTranslations("portal");
  const [file, setFile] = useState<File | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );

  const upload = async () => {
    if (!file) return;
    setState("uploading");
    try {
      const { documentId, uploadUrl } = await requestUploadUrlAction({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        documentType,
        contentLength: file.size,
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await submitItemEvidenceAction({
        itemId,
        documentId,
        validUntil: validUntil || undefined,
      });
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return <span className="badge submitted">{t("uploadDone")}</span>;
  }

  return (
    <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        style={{ fontSize: "0.8rem" }}
      />
      <input
        type="date"
        value={validUntil}
        onChange={(e) => setValidUntil(e.target.value)}
        title={t("uploadValidUntil")}
      />
      <button
        type="button"
        className="secondary"
        disabled={!file || state === "uploading"}
        onClick={upload}
      >
        {state === "uploading" ? "…" : t("uploadCta")}
      </button>
      {state === "error" && (
        <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>
          {t("uploadError")}
        </span>
      )}
    </span>
  );
}
