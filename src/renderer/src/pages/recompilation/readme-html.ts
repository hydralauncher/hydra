import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: true, linkify: true });

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

const ALERT_TITLES: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};
const ALERT_MARKER = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

const renderAlerts = (body: HTMLElement) => {
  for (const blockquote of Array.from(body.querySelectorAll("blockquote"))) {
    const paragraph = blockquote.firstElementChild;
    const text = paragraph?.tagName === "P" ? paragraph.firstChild : null;
    if (!paragraph || text?.nodeType !== 3) continue;

    const match = ALERT_MARKER.exec(text.textContent ?? "");
    if (!match) continue;

    text.textContent = (text.textContent ?? "").slice(match[0].length);
    while (
      paragraph.firstChild &&
      (paragraph.firstChild.nodeName === "BR" ||
        (paragraph.firstChild.nodeType === 3 &&
          !paragraph.firstChild.textContent?.trim()))
    ) {
      paragraph.firstChild.remove();
    }
    if (!paragraph.textContent?.trim() && !paragraph.querySelector("img")) {
      paragraph.remove();
    }

    const kind = match[1].toUpperCase();
    const title = blockquote.ownerDocument.createElement("p");
    title.className = "markdown-alert-title";
    title.textContent = ALERT_TITLES[kind];
    blockquote.prepend(title);
    blockquote.className = `markdown-alert markdown-alert-${kind.toLowerCase()}`;
  }
};

export interface ReadmeBaseUrls {
  links: string;
  images: string;
}

const toHttpsUrl = (value: string, base?: string) => {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

export const getReadmeBaseUrls = (
  repository: string,
  branch: string
): ReadmeBaseUrls => ({
  links: `https://github.com/${repository}/blob/${branch}/`,
  images: `https://raw.githubusercontent.com/${repository}/${branch}/`,
});

const URL_ATTRIBUTES: Record<string, string> = {
  A: "href",
  IMG: "src",
  SOURCE: "srcset",
};

export const sanitizeReadmeHtml = (html: string, base?: ReadmeBaseUrls) => {
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
        const value = attribute.value.trim();
        const url = value.startsWith("#")
          ? null
          : toHttpsUrl(
              value,
              element.tagName === "A" ? base?.links : base?.images
            );
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

  renderAlerts(document.body);

  return document.body.innerHTML;
};

export const renderReadmeHtml = (source: string, base?: ReadmeBaseUrls) =>
  sanitizeReadmeHtml(markdown.render(source), base);
