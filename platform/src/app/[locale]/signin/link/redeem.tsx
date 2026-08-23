"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { magicLinkSignInAction } from "../actions";

export default function RedeemLink({
  locale,
  email,
  token,
}: {
  locale: string;
  email: string;
  token: string;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await magicLinkSignInAction(email, token);
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      router.push(`/${locale}/go`);
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [email, token, locale, router]);

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{failed ? t("linkInvalidTitle") : t("linkSigningIn")}</h1>
        <p className="muted">
          {failed ? t("linkInvalidBody") : t("linkSigningInBody")}
        </p>
        {failed && (
          <Link className="button" href={`/${locale}/signin`}>
            {t("title")}
          </Link>
        )}
      </div>
    </div>
  );
}
