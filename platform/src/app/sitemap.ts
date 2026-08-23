import type { MetadataRoute } from "next";
import { listPrimarySlugs } from "@/modules/companies/service";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? brand.url;

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await listPrimarySlugs().catch(() => []);

  const staticPages = routing.locales.flatMap((locale) => [
    { url: `${BASE_URL}/${locale}`, priority: 1 },
    { url: `${BASE_URL}/${locale}/suppliers`, priority: 0.8 },
    { url: `${BASE_URL}/${locale}/request-work`, priority: 0.9 },
    { url: `${BASE_URL}/${locale}/markets/sweden`, priority: 0.9 },
    { url: `${BASE_URL}/${locale}/markets/norway`, priority: 0.8 },
    { url: `${BASE_URL}/${locale}/markets/denmark`, priority: 0.8 },
    { url: `${BASE_URL}/${locale}/register`, priority: 0.5 },
  ]);

  const companyPages = slugs.flatMap((row) =>
    routing.locales.map((locale) => ({
      url: `${BASE_URL}/${locale}/company/${row.slug}`,
      lastModified: row.updatedAt,
      priority: 0.7,
    })),
  );

  return [...staticPages, ...companyPages];
}
