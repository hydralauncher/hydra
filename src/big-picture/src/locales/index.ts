import en from "./en/translation.json";
import ru from "./ru/translation.json";
import ptBR from "./pt-BR/translation.json";
import es419 from "./es-419/translation.json";
import esES from "./es-ES/translation.json";
import fr from "./fr/translation.json";
import el from "./el/translation.json";
import vi from "./vi/translation.json";

export type BigPictureLanguage =
  | "en"
  | "ru"
  | "pt-BR"
  | "es-419"
  | "es-ES"
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
  "es-419": es419.exact,
  "es-ES": esES.exact,
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
  "es-419": es419.format,
  "es-ES": esES.format,
  fr: fr.format,
  el: el.format,
  vi: vi.format,
};
