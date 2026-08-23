/**
 * Locale-aware name lookup for catalog records (trades, requirement
 * definitions). sv/en/lt are NOT NULL from the original schema; lv/et/pl
 * and later de/da were added as nullable and fall back to English until
 * seeded.
 */
export interface LocalizedNames {
  nameEn: string;
  nameSv: string;
  nameLt: string;
  nameLv?: string | null;
  nameEt?: string | null;
  namePl?: string | null;
  nameDe?: string | null;
  nameDa?: string | null;
}

export function localizedName(record: LocalizedNames, locale: string): string {
  switch (locale) {
    case "sv":
      return record.nameSv;
    case "lt":
      return record.nameLt;
    case "lv":
      return record.nameLv ?? record.nameEn;
    case "et":
      return record.nameEt ?? record.nameEn;
    case "pl":
      return record.namePl ?? record.nameEn;
    case "de":
      return record.nameDe ?? record.nameEn;
    case "da":
      return record.nameDa ?? record.nameEn;
    default:
      return record.nameEn;
  }
}
