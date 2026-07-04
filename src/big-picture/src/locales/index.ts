import en from "./en/translation.json";
import ru from "./ru/translation.json";
import ptBR from "./pt-BR/translation.json";
import esES from "./es-ES/translation.json";
import esLAT from "./es-LAT/translation.json";
import fr from "./fr/translation.json";

export type BigPictureLanguage = "en" | "ru" | "pt-BR" | "es-ES" | "es-LAT" | "fr";

export const exactTranslations: Record<
  BigPictureLanguage,
  Record<string, string>
> = {
  en: en.exact,
  ru: ru.exact,
  "pt-BR": ptBR.exact,
  "es-ES": esES.exact,
  "es-LAT": esLAT.exact,
  fr: fr.exact,
};

export const formatResources: Record<
  BigPictureLanguage,
  Record<string, string>
> = {
  en: en.format,
  ru: ru.format,
  "pt-BR": ptBR.format,
  "es-ES": esES.exact,
  "es-LAT": esLAT.exact,
  es: es.format,
  fr: fr.format,
};
