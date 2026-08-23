"use client";

import { useActionState, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { passwordSignInAction, requestMagicLinkAction } from "./actions";

export default function SignInPage() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkState, requestLink, linkPending] = useActionState(
    requestMagicLinkAction,
    null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await passwordSignInAction(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(t("invalidCredentials"));
      return;
    }
    router.push(`/${params.locale}/go`);
    router.refresh();
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>
        <form onSubmit={submit}>
          <div>
            <label htmlFor="email">{common("email")}</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor="password">{common("password")}</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? common("loading") : common("signIn")}
          </button>
        </form>
        <div className="mt" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
          <h3 style={{ fontSize: "0.95rem" }}>{t("magicLinkTitle")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("magicLinkHint")}
          </p>
          {linkState?.sent ? (
            <p style={{ color: "var(--success)", fontSize: "0.88rem" }}>
              {t("magicLinkSent")}
              {linkState.devUrl && (
                <>
                  {" "}
                  <a href={linkState.devUrl}>{t("magicLinkDevOpen")}</a>
                </>
              )}
            </p>
          ) : (
            <form action={requestLink} style={{ display: "grid", gap: "0.5rem" }}>
              <input type="hidden" name="locale" value={params.locale} />
              <div>
                <label htmlFor="link-email">{common("email")}</label>
                <input
                  id="link-email"
                  name="email"
                  type="email"
                  required
                  defaultValue={email}
                  style={{ width: "100%" }}
                />
              </div>
              <button type="submit" className="secondary" disabled={linkPending}>
                {linkPending ? common("loading") : t("magicLinkCta")}
              </button>
            </form>
          )}
        </div>
        <p className="muted mt" style={{ fontSize: "0.85rem" }}>
          {t("noAccount")}{" "}
          <a href={`/${params.locale}/register`}>{t("registerLink")}</a>
        </p>
      </div>
    </div>
  );
}
