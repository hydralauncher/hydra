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
