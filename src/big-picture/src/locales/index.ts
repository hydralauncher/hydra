import en from "./en/translation.json";
import ru from "./ru/translation.json";
import ptBR from "./pt-BR/translation.json";
import es from "./es/translation.json";
import fr from "./fr/translation.json";
import el from "./el/translation.json";
import vi from "./vi/translation.json";

export type BigPictureLanguage =
  | "en"
  | "ru"
  | "pt-BR"
  | "es"
  | "fr"
  | "el"
  | "vi";

export const exactTranslations: Record<
  BigPictureLanguage,
  Record<string, string>
> = {
  en: en.exact,
  ru: ru.exact,
  "pt-BR": ptBR.exact,
  es: es.exact,
  fr: fr.exact,
  el: el.exact,
  vi: vi.exact,
};

export const formatResources: Record<
  BigPictureLanguage,
  Record<string, string>
> = {
  en: en.format,
  ru: ru.format,
  "pt-BR": ptBR.format,
  es: es.format,
  fr: fr.format,
  el: el.format,
  vi: vi.format,
};
