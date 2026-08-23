"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Glyph, type SymbolName } from "@/components/brand/symbols";

type Item = { key: string; href: string; label: string; icon: SymbolName };
type Group = { title: string; items: Item[] };

export type OpsNavLabels = {
  dashboard: string;
  verification: string;
  reviewQueue: string;
  companies: string;
  rfqs: string;
  deals: string;
  tasks: string;
  staff: string;
  groupVerification: string;
  groupTrade: string;
  groupSystem: string;
};

/**
 * Ops-console navigation, ChatGPT-style: grouped, icon + label, a single
 * rounded active pill. Icons come from the Piotrr symbol language; the
 * active row is resolved client-side from the current path (longest match
 * wins, so /admin/companies/123 keeps "Företag" lit).
 */
export function OpsNav({
  locale,
  labels,
}: {
  locale: string;
  labels: OpsNavLabels;
}) {
  const pathname = usePathname();
  const base = `/${locale}/admin`;
  const groups: Group[] = [
    {
      title: labels.groupVerification,
      items: [
        { key: "dashboard", href: base, label: labels.dashboard, icon: "visa" },
        { key: "verification", href: `${base}/verification`, label: labels.verification, icon: "verifierad" },
        { key: "reviewQueue", href: `${base}/queue`, label: labels.reviewQueue, icon: "checklista" },
      ],
    },
    {
      title: labels.groupTrade,
      items: [
        { key: "companies", href: `${base}/companies`, label: labels.companies, icon: "lagenhetshus" },
        { key: "rfqs", href: `${base}/rfqs`, label: labels.rfqs, icon: "forfragan" },
        { key: "deals", href: `${base}/deals`, label: labels.deals, icon: "utbyte" },
      ],
    },
    {
      title: labels.groupSystem,
      items: [
        { key: "tasks", href: `${base}/tasks`, label: labels.tasks, icon: "nasta-steg" },
        { key: "staff", href: `${base}/staff`, label: labels.staff, icon: "kopare" },
      ],
    },
  ];

  // Longest matching href is the active one; the bare dashboard only matches exactly.
  const all = groups.flatMap((g) => g.items);
  const active = all
    .filter((it) => (it.href === base ? pathname === base : pathname.startsWith(it.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.key;

  return (
    <nav className="ops-nav" aria-label="Ops">
      {groups.map((g) => (
        <div className="ops-group" key={g.title}>
          <div className="ops-group-title">{g.title}</div>
          {g.items.map((it) => (
            <Link
              key={it.key}
              href={it.href}
              className={`ops-link${active === it.key ? " active" : ""}`}
              aria-current={active === it.key ? "page" : undefined}
            >
              <Glyph name={it.icon} />
              <span>{it.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
