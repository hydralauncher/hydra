import type { Plugin, Rule } from "postcss";

const BIG_PICTURE_ROOT_SELECTOR = "#big-picture";
const BIG_PICTURE_PATH_FRAGMENT = "/src/big-picture/";
const RENDERER_PATH_FRAGMENT = "/src/renderer/";
const ROOT_SELECTOR_ALIASES = new Set([":root", "html", "body", "#root"]);

const isBigPictureStyle = (filePath?: string): boolean => {
  if (!filePath) return false;

  return filePath.replaceAll("\\", "/").includes(BIG_PICTURE_PATH_FRAGMENT);
};

const isRendererStyle = (filePath?: string): boolean => {
  if (!filePath) return false;

  return filePath.replaceAll("\\", "/").includes(RENDERER_PATH_FRAGMENT);
};

const shouldSkipRule = (rule: Rule): boolean => {
  const parent = rule.parent;

  return (
    parent?.type === "atrule" &&
    "name" in parent &&
    parent.name.toLowerCase().endsWith("keyframes")
  );
};

const shouldSkipExclusion = (selector: string): boolean => {
  const trimmed = selector.trim();

  if (!trimmed) return true;
  if (trimmed === "*") return true;
  if (ROOT_SELECTOR_ALIASES.has(trimmed)) return true;
  if (trimmed.includes("::")) return true;

  return false;
};

const scopeSelector = (selector: string): string => {
  const trimmedSelector = selector.trim();

  if (!trimmedSelector) return selector;

  if (
    trimmedSelector === BIG_PICTURE_ROOT_SELECTOR ||
    trimmedSelector.startsWith(`${BIG_PICTURE_ROOT_SELECTOR} `) ||
    trimmedSelector.startsWith(`${BIG_PICTURE_ROOT_SELECTOR}:`)
  ) {
    return selector;
  }

  if (ROOT_SELECTOR_ALIASES.has(trimmedSelector)) {
    return BIG_PICTURE_ROOT_SELECTOR;
  }

  return `${BIG_PICTURE_ROOT_SELECTOR} ${selector}`;
};

const excludeFromBigPicture = (selector: string): string => {
  if (shouldSkipExclusion(selector)) {
    return selector;
  }

  return `${selector}:where(:not(${BIG_PICTURE_ROOT_SELECTOR} *))`;
};

export const scopeBigPictureCss = (): Plugin => ({
  postcssPlugin: "scope-big-picture-css",
  Rule(rule) {
    if (shouldSkipRule(rule)) {
      return;
    }

    if (isBigPictureStyle(rule.source?.input.file)) {
      rule.selectors = rule.selectors.map(scopeSelector);
      return;
    }

    if (isRendererStyle(rule.source?.input.file)) {
      rule.selectors = rule.selectors.map(excludeFromBigPicture);
    }
  },
});
