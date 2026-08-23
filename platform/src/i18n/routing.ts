import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // sv/en, every supplier-side language (Lithuanian, Latvian, Estonian,
  // Polish) and every buyer-side destination language (German, Danish).
  locales: ["sv", "en", "lt", "lv", "et", "pl", "de", "da"],
  defaultLocale: "sv",
});
