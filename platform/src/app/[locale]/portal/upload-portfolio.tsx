"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  createPortfolioItemAction,
  requestPortfolioUploadAction,
} from "./actions";

/** Project-image upload: presigned PUT, then a pending item for moderation */
export default function UploadPortfolio() {
  const t = useTranslations("portal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");

  const upload = async () => {
    if (!file || title.trim().length < 2) return;
    setState("uploading");
    try {
      const { objectKey, uploadUrl } = await requestPortfolioUploadAction({
        fileName: file.name,
        contentType: file.type || "image/jpeg",
        contentLength: file.size,
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await createPortfolioItemAction({
        title: title.trim(),
        description: description.trim() || undefined,
        objectKey,
        contentType: file.type || "image/jpeg",
      });
      setState("done");
      setTitle("");
      setDescription("");
      setFile(null);
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p>
        <span className="badge submitted">{t("portfolioSubmitted")}</span>{" "}
        <button
          type="button"
          className="crumb"
          style={{ background: "none", border: 0, color: "var(--primary)", cursor: "pointer", font: "inherit" }}
          onClick={() => setState("idle")}
        >
          {t("portfolioAddAnother")}
        </button>
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem", maxWidth: 480 }}>
      <div>
        <label htmlFor="pf-title">{t("portfolioTitle")}</label>
        <input
          id="pf-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("portfolioTitlePlaceholder")}
          style={{ width: "100%" }}
        />
      </div>
      <div>
        <label htmlFor="pf-desc">{t("portfolioDesc")}</label>
        <input
          id="pf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn"
          style={{ font: "inherit", fontWeight: 600, cursor: "pointer", padding: "0.45rem 0.95rem", borderRadius: 8, border: "1px solid var(--primary)", background: "var(--primary)", color: "var(--primary-contrast)" }}
          disabled={!file || title.trim().length < 2 || state === "uploading"}
          onClick={upload}
        >
          {state === "uploading" ? "…" : t("portfolioCta")}
        </button>
      </div>
      {state === "error" && (
        <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{t("uploadError")}</span>
      )}
      <span className="muted" style={{ fontSize: "0.78rem" }}>{t("portfolioModerationNote")}</span>
    </div>
  );
}
