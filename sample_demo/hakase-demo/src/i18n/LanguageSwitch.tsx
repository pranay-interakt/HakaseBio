/** Locale switch. Present on every entry point, not only inside the workspace. */
import { LOCALES, t } from "./index";
import { useLocale } from "./useLocale";

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return <div className="lang-switch" role="group" aria-label={t("Language")}>
    {LOCALES.map((entry) => (
      <button key={entry.code} className={locale === entry.code ? "active" : ""}
        aria-pressed={locale === entry.code} lang={entry.code}
        onClick={() => setLocale(entry.code)}>{entry.short}</button>
    ))}
  </div>;
}
