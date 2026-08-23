"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setPasswordAction, type SetPasswordState } from "./actions";

/**
 * Set (or replace) your own password. This is the recovery path after the
 * first magic-link verification clears a password that was set before the
 * mailbox was proven — a verified owner signs in with a link, then sets a
 * password here. Available to any signed-in account.
 */
export default function SetPasswordForm() {
  const t = useTranslations("portal");
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    {},
  );

  return (
    <div className="card">
      <h3>{t("setPasswordTitle")}</h3>
      <p className="muted">{t("setPasswordBody")}</p>
      <form action={action}>
        <label htmlFor="new-password">{t("setPasswordLabel")}</label>
        <input
          id="new-password"
          name="password"
          type="password"
          minLength={10}
          required
          autoComplete="new-password"
        />
        <button type="submit" disabled={pending}>
          {t("setPasswordCta")}
        </button>
      </form>
      {state.ok && (
        <p className="muted" style={{ color: "var(--success)", marginTop: "0.5rem" }}>
          {t("setPasswordOk")}
        </p>
      )}
      {state.error === "invalid" && (
        <p className="muted" style={{ color: "var(--danger)", marginTop: "0.5rem" }}>
          {t("setPasswordError")}
        </p>
      )}
    </div>
  );
}
