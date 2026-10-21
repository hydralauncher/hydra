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
const TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, " "],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&#x27;/g, "'"],
  [/&amp;/g, "&"],
];

export const richTextToPlainText = (html: string) =>
  HTML_ENTITIES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    html
      .replace(BLOCK_BOUNDARY_PATTERN, (boundary) => `${boundary}\n`)
      .replace(TAG_PATTERN, "")
  )
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
