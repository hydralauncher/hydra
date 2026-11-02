const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

export const escapeHtmlText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const toRichTextHtml = (value: string) => {
  if (HTML_TAG_PATTERN.test(value)) return value;

  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => `<p>${escapeHtmlText(line)}</p>`)
    .join("");
};

const BLOCK_BOUNDARY_PATTERN =
  /<\/(?:p|li|blockquote|pre|h[1-6])>|<br\s*\/?>|<hr\s*\/?>/gi;
const HTML_ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, "\u00a0"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&#x27;/g, "'"],
  [/&amp;/g, "&"],
];

const stripTags = (html: string) => {
  let result = "";
  let index = 0;

  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      result += html.slice(index);
      break;
    }

    result += html.slice(index, tagStart);
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) break;
    index = tagEnd + 1;
  }

  return result;
};

const trimTrailingSpacesAndTabs = (line: string) => {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) {
    end -= 1;
  }
  return line.slice(0, end);
};

export const richTextToPlainText = (html: string) =>
  HTML_ENTITIES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    stripTags(
      html.replace(BLOCK_BOUNDARY_PATTERN, (boundary) => `${boundary}\n`)
    )
  )
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .map(trimTrailingSpacesAndTabs)
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
