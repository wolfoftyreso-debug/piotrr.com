import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { hasRole } from "@/modules/identity/rbac";

export const dynamic = "force-dynamic";

/** Post-login router: sends each role to its surface */
export default async function Go({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await currentActor();
  if (!actor) redirect(`/${locale}/signin`);
  if (hasRole(actor, "ops")) redirect(`/${locale}/admin`);
  redirect(`/${locale}/portal`);
}
