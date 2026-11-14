import DOMPurify from "dompurify";

export function removeZalgoText(text: string): string {
  // Match combining characters that are commonly used in Zalgo text
  // Using a more explicit approach to avoid misleading-character-class warning
  const combiningMarks = [
    /[\u0300-\u036F]/g, // Combining Diacritical Marks
    /[\u1AB0-\u1AFF]/g, // Combining Diacritical Marks Extended
    /[\u1DC0-\u1DFF]/g, // Combining Diacritical Marks Supplement
    /[\u20D0-\u20FF]/g, // Combining Diacritical Marks for Symbols
    /[\uFE20-\uFE2F]/g, // Combining Half Marks
  ];

  let result = text;
  for (const regex of combiningMarks) {
    result = result.replace(regex, "");
  }
  return result;
}

const SANITIZE_HTML_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
];

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  return removeZalgoText(
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: SANITIZE_HTML_ALLOWED_TAGS,
      ALLOWED_ATTR: [],
    })
  ).trim();
}

export function stripHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  let cleanText = tempDiv.textContent || tempDiv.innerText || "";

  cleanText = removeZalgoText(cleanText);

  return cleanText;
}
