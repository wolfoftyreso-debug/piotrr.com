"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export interface ApiKeyView {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  ownerEmail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Machine credentials for `/api/v1`.
 *
 * The plaintext key is rendered exactly once, right after minting — the
 * database only ever held its digest, so there is no "show again".
 */
export default function ApiKeys({
  keys,
  accounts,
  scopes,
}: {
  keys: ApiKeyView[];
  accounts: { id: string; email: string }[];
  scopes: readonly string[];
}) {
  const t = useTranslations("apiKeys");
  const [state, formAction, pending] = useActionState(createApiKeyAction, null);

  return (
    <div className="card">
      <h3>{t("title")}</h3>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        {t("hint")}
      </p>

      {state?.plaintext && (
        <div className="card" style={{ background: "#fffbe6", margin: "0.75rem 0" }}>
          <strong>{t("shownOnce")}</strong>
          <pre style={{ overflowX: "auto", margin: "0.5rem 0 0" }}>
            <code>{state.plaintext}</code>
          </pre>
        </div>
      )}
      {state?.error && <p className="danger">{state.error}</p>}

      {keys.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("prefix")}</th>
              <th>{t("actsAs")}</th>
              <th>{t("scopes")}</th>
              <th>{t("lastUsed")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} style={key.revokedAt ? { opacity: 0.5 } : undefined}>
                <td>{key.name}</td>
                <td>
                  <code>bb_{key.prefix}…</code>
                </td>
                <td>{key.ownerEmail}</td>
                <td>{key.scopes.join(", ") || "—"}</td>
                <td>{key.lastUsedAt ?? t("never")}</td>
                <td>
                  {key.revokedAt ? (
                    <span className="muted">{t("revoked")}</span>
                  ) : (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="keyId" value={key.id} />
                      <button
                        type="submit"
                        className="danger"
                        style={{ padding: "0.2rem 0.6rem" }}
                      >
                        {t("revoke")}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={formAction} className="mt">
        <div className="inline">
          <div>
            <label htmlFor="key-name">{t("name")}</label>
            <input id="key-name" name="name" required minLength={2} />
          </div>
          <div>
            <label htmlFor="key-user">{t("actsAs")}</label>
            <select id="key-user" name="userId" required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset style={{ border: 0, padding: "0.5rem 0" }}>
          <legend className="muted" style={{ fontSize: "0.85rem" }}>
            {t("scopes")}
          </legend>
          {scopes.map((scope) => (
            <label key={scope} style={{ marginRight: "1rem", fontWeight: 400 }}>
              <input type="checkbox" name="scopes" value={scope} /> {scope}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={pending}>
          {t("create")}
        </button>
      </form>
    </div>
  );
}
