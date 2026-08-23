import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentActor } from "@/lib/auth";
import { listStaffUsers } from "@/modules/identity/service";
import { provisionStaffAction, setStaffActiveAction } from "./actions";
import { API_SCOPES, listApiKeys } from "@/modules/identity/api-keys";
import ApiKeys, { type ApiKeyView } from "./api-keys";
import SetPasswordForm from "@/app/[locale]/portal/set-password-form";

export const dynamic = "force-dynamic";

/** Internal accounts (Section 5/M1). Only an admin may create or suspend. */
export default async function StaffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("staff");
  const actor = await currentActor();
  const staff = actor ? await listStaffUsers(actor) : [];
  const isAdmin = actor?.role === "admin";

  const rawKeys = actor ? await listApiKeys(actor) : [];
  const emailById = new Map(staff.map((u) => [u.id, u.email]));
  const keys: ApiKeyView[] = rawKeys.map((k) => ({
    id: k.id,
    prefix: k.prefix,
    name: k.name,
    scopes: k.scopes,
    ownerEmail: emailById.get(k.userId) ?? k.userId,
    createdAt: k.createdAt.toISOString().slice(0, 10),
    lastUsedAt: k.lastUsedAt?.toISOString().slice(0, 16).replace("T", " ") ?? null,
    revokedAt: k.revokedAt?.toISOString().slice(0, 10) ?? null,
  }));

  return (
    <div>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="card mt">
        <table>
          <thead>
            <tr>
              <th>{t("email")}</th>
              <th>{t("name")}</th>
              <th>{t("role")}</th>
              <th>{t("status")}</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {staff.map((user) => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>{user.name ?? "—"}</td>
                <td>
                  <span className="badge">{user.role}</span>
                </td>
                <td>
                  {user.active ? (
                    <span className="badge approved">{t("active")}</span>
                  ) : (
                    <span className="badge rejected">{t("suspended")}</span>
                  )}
                  {!user.passwordHash && (
                    <>
                      {" "}
                      <span className="badge submitted">{t("noPassword")}</span>
                    </>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    {actor?.userId !== user.id && (
                      <form action={setStaffActiveAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={user.active ? "0" : "1"}
                        />
                        <button
                          type="submit"
                          className={user.active ? "danger" : "secondary"}
                          style={{ padding: "0.2rem 0.6rem" }}
                        >
                          {user.active ? t("suspend") : t("restore")}
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="card">
          <h3>{t("addTitle")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("addHint")}
          </p>
          <form action={provisionStaffAction} className="inline">
            <div>
              <label htmlFor="staff-email">{t("email")}</label>
              <input id="staff-email" name="email" type="email" required />
            </div>
            <div>
              <label htmlFor="staff-name">{t("name")}</label>
              <input id="staff-name" name="name" required minLength={2} />
            </div>
            <div>
              <label htmlFor="staff-role">{t("role")}</label>
              <select id="staff-role" name="role" defaultValue="ops">
                <option value="ops">ops</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button type="submit">{t("addCta")}</button>
          </form>
        </div>
      )}

      {isAdmin && (
        <ApiKeys
          keys={keys}
          accounts={staff.map((u) => ({ id: u.id, email: u.email }))}
          scopes={API_SCOPES}
        />
      )}

      {/* A staff account starts password-less and is first reached by magic
          link (see the "noPassword" badge above); this is where the signed-in
          colleague — ops or admin — sets their own password afterwards. The
          action is bound to their own live session, so it needs no role gate. */}
      <div className="card" style={{ maxWidth: 460 }}>
        <SetPasswordForm />
      </div>
    </div>
  );
}
