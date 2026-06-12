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

export function resolveBigPictureLanguage(
  language = i18next.resolvedLanguage ?? i18next.language ?? "en"
): BigPictureLanguage {
  if (language.startsWith("ru")) return "ru";
  if (language.startsWith("pt")) return "pt-BR";
  if (language.startsWith("es")) return "es";
  return "en";
}

function getSourceText(value: string) {
  return reverseTranslations.get(value) ?? value;
}

function translateExactText(value: string) {
  const language = resolveBigPictureLanguage();
  const sourceText = getSourceText(value);

  return exactTranslations[language][sourceText] ?? sourceText;
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
    await i18next.changeLanguage(userPreferences.language);
  } else if (electron?.updateUserPreferences) {
    await electron.updateUserPreferences({ language: i18next.language });
  }

  syncDocumentLanguage(i18next.language);
  i18next.on("languageChanged", syncDocumentLanguage);

  electron?.onUserPreferencesUpdated?.((preferences) => {
    if (preferences?.language && preferences.language !== i18next.language) {
      i18next.changeLanguage(preferences.language).catch((error) => {
        console.error("Failed to change Big Picture language", error);
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
