import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: true, linkify: true });

// Like GitHub, only link bare URLs that have a protocol: "CONTRIBUTING.md" is
// a file name, not the .md domain.
markdown.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

const REMOVED_ELEMENTS =
  "script, style, iframe, object, embed, svg, math, form, input, button, textarea, select, template, link, meta, base";

const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "IMG",
  "LI",
  "OL",
  "P",
  "PICTURE",
  "PRE",
  "S",
  "SOURCE",
  "SPAN",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL",
]);

const toHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const URL_ATTRIBUTES: Record<string, string> = {
  A: "href",
  IMG: "src",
  SOURCE: "srcset",
};

/**
 * README HTML is bundled with the app, but it still goes through the same kind
 * of allowlist the store descriptions use: known tags only, no inline styles
 * or handlers, absolute https URLs only, and links open in the browser.
 */
export const sanitizeReadmeHtml = (html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const element of document.body.querySelectorAll(REMOVED_ELEMENTS)) {
    element.remove();
  }

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const urlAttribute = URL_ATTRIBUTES[element.tagName];

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();

      if (name === "alt" || name === "title") continue;
      if (element.tagName === "SOURCE" && name === "media") continue;

      if (name === urlAttribute) {
        const url = toHttpsUrl(attribute.value.trim());
        if (url) {
          element.setAttribute(name, url);
          continue;
        }
      }

      element.removeAttribute(attribute.name);
    }

    if (element.tagName === "A" && element.hasAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }

    if (element.tagName === "IMG") {
      element.setAttribute("loading", "lazy");
    }
  }

  // Hydra is always dark: use the dark variant of GitHub <picture> images
  // instead of following the OS color scheme.
  for (const picture of document.body.querySelectorAll("picture")) {
    const darkSource = picture.querySelector(
      'source[media*="prefers-color-scheme: dark"][srcset]'
    );
    const image = picture.querySelector("img");
    if (darkSource && image) {
      image.setAttribute("src", darkSource.getAttribute("srcset")!);
    }
    picture.querySelectorAll("source").forEach((source) => source.remove());
  }

  return document.body.innerHTML;
};

/** Renders a bundled GitHub README to sanitized HTML. */
export const renderReadmeHtml = (source: string) =>
  sanitizeReadmeHtml(markdown.render(source));
