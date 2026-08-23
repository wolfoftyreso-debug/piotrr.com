"use client";

import { useActionState, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { registerAction, type RegisterFormState } from "./actions";

export default function RegisterPage() {
  const t = useTranslations("register");
  const common = useTranslations("common");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [role, setRole] = useState<"buyer" | "supplier">("buyer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, formAction, pending] = useActionState<RegisterFormState, FormData>(
    registerAction,
    {},
  );

  // registerAction already opened the session; just continue to the
  // surface that matches the new account's role.
  useEffect(() => {
    if (!state.ok) return;
    router.push(`/${params.locale}/go`);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ maxWidth: 460 }}>
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>

        {/* Account type — Alibaba-style: customer or company */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", margin: "0.75rem 0" }}>
          <button
            type="button"
            className={role === "buyer" ? undefined : "secondary"}
            onClick={() => setRole("buyer")}
          >
            {t("asBuyer")}
          </button>
          <button
            type="button"
            className={role === "supplier" ? undefined : "secondary"}
            onClick={() => setRole("supplier")}
          >
            {t("asSupplier")}
          </button>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {role === "buyer" ? t("buyerHint") : t("supplierHint")}
        </p>

        <form action={formAction} style={{ display: "grid", gap: "0.75rem" }}>
          <input type="hidden" name="role" value={role} />
          <div>
            <label htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required style={{ width: "100%" }} />
          </div>
          <div>
            <label htmlFor="email">{common("email")}</label>
            <input
              id="email"
              name="email"
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
              name="password"
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%" }}
            />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {t("passwordHint")}
            </span>
          </div>
          {state.error === "email_taken" && (
            <p style={{ color: "var(--danger)" }}>{t("emailTaken")}</p>
          )}
          {state.error === "rate_limited" && (
            <p style={{ color: "var(--danger)" }}>{t("rateLimited")}</p>
          )}
          {state.error === "invalid" && (
            <p style={{ color: "var(--danger)" }}>{t("invalid")}</p>
          )}
          <button type="submit" disabled={pending}>
            {pending ? common("loading") : t("cta")}
          </button>
        </form>

        <p className="muted mt" style={{ fontSize: "0.85rem" }}>
          {t("haveAccount")}{" "}
          <Link href={`/${params.locale}/signin`}>{common("signIn")}</Link>
        </p>
      </div>
    </div>
  );
}
