import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { opsTasks } from "@/modules/verification/schema";
import { completeTaskAction } from "@/app/[locale]/admin/actions";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tasks");

  const rows = await db
    .select()
    .from(opsTasks)
    .where(eq(opsTasks.status, "open"))
    .orderBy(opsTasks.dueAt);

  return (
    <div>
      <h1>{t("title")}</h1>
      {rows.length === 0 ? (
        <p className="muted mt">{t("empty")}</p>
      ) : (
        <table className="mt">
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.title}</strong>
                  {task.detail && (
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {task.detail}
                    </div>
                  )}
                </td>
                <td className="muted">
                  {task.dueAt
                    ? `${t("due")}: ${new Date(task.dueAt).toISOString().slice(0, 10)}`
                    : "—"}
                </td>
                <td>
                  <form action={completeTaskAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <button type="submit" className="secondary">
                      {t("done")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
