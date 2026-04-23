import type { Plugin, Rule } from "postcss";

const BIG_PICTURE_ROOT_SELECTOR = "#big-picture";
const BIG_PICTURE_PATH_FRAGMENT = "/src/big-picture/";
const ROOT_SELECTOR_ALIASES = new Set([":root", "html", "body", "#root"]);

const isBigPictureStyle = (filePath?: string): boolean => {
  if (!filePath) return false;

  return filePath.replaceAll("\\", "/").includes(BIG_PICTURE_PATH_FRAGMENT);
};

const shouldSkipRule = (rule: Rule): boolean => {
  const parent = rule.parent;

  return (
    parent?.type === "atrule" &&
    "name" in parent &&
    parent.name.toLowerCase().endsWith("keyframes")
  );
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

export const scopeBigPictureCss = (): Plugin => ({
  postcssPlugin: "scope-big-picture-css",
  Rule(rule) {
    if (!isBigPictureStyle(rule.source?.input.file) || shouldSkipRule(rule)) {
      return;
    }

    rule.selectors = rule.selectors.map(scopeSelector);
  },
});
