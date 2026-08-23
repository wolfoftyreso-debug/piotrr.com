"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

/**
 * Error boundary for everything under a locale.
 *
 * There was none, so any unhandled failure — most realistically the
 * database being unreachable on a page that genuinely needs it, like
 * search — reached the visitor as a raw framework 500. That is the
 * difference between "this service is having trouble, try again" and a
 * blank page that looks like the company has gone out of business.
 *
 * Deliberately says nothing about the cause. The visitor cannot act on
 * "connection refused", and an error page is a poor place to describe
 * internal topology.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // The digest is what ties this page to the server log line that has
    // the stack; surfacing it is what makes a support ticket actionable.
    console.error("Unhandled error", error.digest);
  }, [error]);

  return (
    <div className="auth-wrap">
      <div className="card auth-card" role="alert">
        <h1>{t("title")}</h1>
        <p className="muted">{t("body")}</p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button type="button" onClick={reset}>
            {t("retry")}
          </button>
        </div>
        {error.digest && (
          <p className="muted" style={{ fontSize: "0.75rem", marginTop: "1rem" }}>
            {t("reference")}: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
