import i18n from "i18next";

import { createLanguageApplier } from "./apply-language-core";
import { loadLocale } from "./load-locale";

export const applyLanguage = createLanguageApplier(i18n, loadLocale);
