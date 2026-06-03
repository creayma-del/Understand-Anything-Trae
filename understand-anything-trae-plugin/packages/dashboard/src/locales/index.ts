import en from "./en";
import zh from "./zh";

export type LocaleKey = "en" | "zh";
export type Locale = typeof en;

export const locales: Record<LocaleKey, Locale> = {
  en,
  zh,
};

export function getLocale(key: LocaleKey): Locale {
  return locales[key] ?? locales.zh;
}

export function resolveLocaleKey(lang: string | undefined): LocaleKey {
  if (!lang) return "zh";
  const normalized = lang.toLowerCase().replace(/[_\s]/g, "-");
  if (normalized === "zh" || normalized === "chinese" || normalized === "zh-cn") return "zh";
  return "en";
}

export { en, zh };
