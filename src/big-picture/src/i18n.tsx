import { useEffect } from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useLocation } from "react-router-dom";

import localeResources from "@locales";

import {
  exactTranslations,
  formatResources,
  type BigPictureLanguage,
} from "./locales";
import {
  isLatinAmericanSpanishCode,
  resolveLanguageKey,
  SPANISH_ES_KEY,
  SPANISH_LAT_KEY,
} from "@shared";

const TRANSLATED_ATTRIBUTES = [
  "aria-label",
  "alt",
  "placeholder",
  "title",
] as const;

const reverseTranslations = new Map<string, string>();

for (const translations of Object.values(exactTranslations)) {
  for (const [sourceText, translatedText] of Object.entries(translations)) {
    reverseTranslations.set(translatedText, sourceText);
  }
}

let bigPictureResourcesLoaded = false;

export function ensureBigPictureI18nResources() {
  if (bigPictureResourcesLoaded) return;

  for (const [language, resources] of Object.entries(formatResources)) {
    i18next.addResourceBundle(language, "big_picture", resources, true, true);
  }

  bigPictureResourcesLoaded = true;
}

const SUPPORTED_BIG_PICTURE_LANGUAGES: ReadonlySet<BigPictureLanguage> =
  new Set([
    "en",
    "ru",
    "pt-BR",
    SPANISH_ES_KEY as BigPictureLanguage,
    SPANISH_LAT_KEY as BigPictureLanguage,
    "fr",
  ]);

function hasUsableBigPictureResources(language: BigPictureLanguage): boolean {
  return (
    Boolean(exactTranslations[language]) &&
    Boolean(formatResources[language]) &&
    Object.keys(formatResources[language]).length > 0
  );
}

function resolveWithSpanishResourceFallback(
  candidate: BigPictureLanguage
): BigPictureLanguage {
  if (hasUsableBigPictureResources(candidate)) return candidate;

  if (
    candidate !== SPANISH_LAT_KEY &&
    hasUsableBigPictureResources(SPANISH_LAT_KEY as BigPictureLanguage)
  ) {
    return SPANISH_LAT_KEY as BigPictureLanguage;
  }

  return "en";
}

export function resolveBigPictureLanguage(
  language = i18next.resolvedLanguage ?? i18next.language ?? "en"
): BigPictureLanguage {
  const baseLang = language.split("-")[0];

  if (baseLang === "ru") return "ru";
  if (baseLang === "pt") return "pt-BR";
  if (baseLang === "fr") return "fr";

  if (language === SPANISH_ES_KEY || language.startsWith("es-ES")) {
    return resolveWithSpanishResourceFallback(
      SPANISH_ES_KEY as BigPictureLanguage
    );
  }

  if (isLatinAmericanSpanishCode(language)) {
    return resolveWithSpanishResourceFallback(
      SPANISH_LAT_KEY as BigPictureLanguage
    );
  }

  if (baseLang === "es") {
    return resolveWithSpanishResourceFallback(
      SPANISH_LAT_KEY as BigPictureLanguage
    );
  }

  return "en";
}

function needsSpanishLanguageMigration(storedLanguage: string): boolean {
  if (storedLanguage === "es") return true;

  const baseLang = storedLanguage.split("-")[0];
  if (baseLang !== "es") return false;

  return !SUPPORTED_BIG_PICTURE_LANGUAGES.has(
    storedLanguage as BigPictureLanguage
  );
}

function resolveSpanishMigrationTarget(storedLanguage: string): string {
  return resolveBigPictureLanguage(storedLanguage);
}

async function applyStoredLanguagePreference(storedLanguage: string) {
  try {
    await i18next.changeLanguage(storedLanguage);
  } catch (err) {
    console.error("Failed to change Big Picture language", err);
    const baseLang = storedLanguage.split("-")[0];
    const fallbackLanguage = baseLang === "es" ? SPANISH_LAT_KEY : "en";
    await i18next.changeLanguage(fallbackLanguage);
  }
}

function getSourceText(value: string) {
  return reverseTranslations.get(value) ?? value;
}

function translateExactText(value: string) {
  const language = resolveBigPictureLanguage();
  const sourceText = getSourceText(value);

  return exactTranslations[language]?.[sourceText] ?? sourceText;
}

function translateTextNode(node: Text) {
  const value = node.nodeValue ?? "";
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return;

  const [, leadingWhitespace, text, trailingWhitespace] = match;
  const translatedText = translateExactText(text);
  const nextValue = `${leadingWhitespace}${translatedText}${trailingWhitespace}`;

  if (nextValue !== value) {
    node.nodeValue = nextValue;
  }
}

function translateElementAttributes(element: Element) {
  for (const attributeName of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attributeName);
    if (!value) continue;

    const translatedValue = translateExactText(value);
    if (translatedValue !== value) {
      element.setAttribute(attributeName, translatedValue);
    }
  }
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node as Text);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  translateElementAttributes(element);

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
  );

  while (walker.nextNode()) {
    const currentNode = walker.currentNode;

    if (currentNode.nodeType === Node.TEXT_NODE) {
      translateTextNode(currentNode as Text);
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(currentNode as Element);
    }
  }
}

export function applyBigPictureDomTranslations() {
  const root = document.getElementById("big-picture");
  if (!root) return;

  translateNode(root);
}

export async function initializeBigPictureI18n() {
  if (!i18next.isInitialized) {
    await i18next
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        resources: localeResources,
        fallbackLng: "en",
        interpolation: {
          escapeValue: false,
        },
      });
  }

  ensureBigPictureI18nResources();

  const electron = globalThis.window?.electron as
    | {
        getUserPreferences?: () => Promise<{ language?: string } | null>;
        onUserPreferencesUpdated?: (
          callback: (preferences: { language?: string } | null) => void
        ) => () => void;
        updateUserPreferences?: (preferences: {
          language: string;
        }) => Promise<void>;
      }
    | undefined;

  const syncDocumentLanguage = (language: string) => {
    document.documentElement.lang = language;
    document.documentElement.dir = i18next.dir(language);
  };

  const userPreferences = await electron?.getUserPreferences?.();

  if (userPreferences?.language) {
    if (needsSpanishLanguageMigration(userPreferences.language)) {
      const migrated = resolveSpanishMigrationTarget(userPreferences.language);
      try {
        await i18next.changeLanguage(migrated);
        await electron?.updateUserPreferences?.({ language: migrated });
      } catch (err) {
        console.error("Failed to persist migrated language preference", err);
      }
    } else {
      await applyStoredLanguagePreference(userPreferences.language);
    }
  } else if (electron?.updateUserPreferences) {
    const detectedLanguage = resolveLanguageKey(
      i18next.language,
      Object.keys(localeResources)
    );
    await i18next.changeLanguage(detectedLanguage);
    await electron.updateUserPreferences({ language: detectedLanguage });
  }

  const activeLanguage = i18next.resolvedLanguage ?? i18next.language;

  if (activeLanguage.split("-")[0] === "es") {
    const safeSpanishLanguage = resolveBigPictureLanguage(activeLanguage);

    if (safeSpanishLanguage !== activeLanguage) {
      try {
        await i18next.changeLanguage(safeSpanishLanguage);
      } catch (err) {
        console.error("Failed to apply Big Picture language fallback", err);
      }
    }
  }

  syncDocumentLanguage(i18next.language);
  i18next.on("languageChanged", syncDocumentLanguage);

  electron?.onUserPreferencesUpdated?.((preferences) => {
    if (!preferences?.language) return;
    const nextLanguage = needsSpanishLanguageMigration(preferences.language)
      ? resolveSpanishMigrationTarget(preferences.language)
      : preferences.language;

    if (nextLanguage !== i18next.language) {
      i18next.changeLanguage(nextLanguage).catch((error) => {
        console.error("Failed to change Big Picture language", error);
      });
    }

    if (
      nextLanguage !== preferences.language &&
      electron?.updateUserPreferences
    ) {
      electron
        .updateUserPreferences({ language: nextLanguage })
        .catch((error) => {
          console.error(
            "Failed to persist migrated language preference",
            error
          );
        });
    }
  });
}

export function BigPictureI18nBridge() {
  const location = useLocation();

  useEffect(() => {
    ensureBigPictureI18nResources();

    let frameId: number | null = null;
    let isApplyingTranslations = false;

    const applyTranslations = () => {
      frameId = null;
      isApplyingTranslations = true;
      applyBigPictureDomTranslations();
      isApplyingTranslations = false;
    };

    const scheduleTranslations = () => {
      if (frameId !== null) return;
      frameId = globalThis.window.requestAnimationFrame(applyTranslations);
    };

    const observer = new MutationObserver(() => {
      if (!isApplyingTranslations) {
        scheduleTranslations();
      }
    });

    const attachObserver = () => {
      const root = document.getElementById("big-picture");
      if (!root) return false;

      observer.observe(root, {
        attributeFilter: [...TRANSLATED_ATTRIBUTES],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });

      return true;
    };

    const retryObserverId = attachObserver()
      ? null
      : globalThis.window.setTimeout(() => {
          attachObserver();
          scheduleTranslations();
        }, 0);

    i18next.on("languageChanged", scheduleTranslations);
    scheduleTranslations();

    return () => {
      observer.disconnect();
      i18next.off("languageChanged", scheduleTranslations);

      if (retryObserverId !== null) {
        globalThis.window.clearTimeout(retryObserverId);
      }

      if (frameId !== null) {
        globalThis.window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  useEffect(() => {
    applyBigPictureDomTranslations();
  }, [location.pathname, location.search]);

  return null;
}
