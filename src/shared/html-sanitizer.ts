function removeZalgoText(text: string): string {
  // eslint-disable-next-line no-misleading-character-class
  const zalgoRegex =
    /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

  return text.replace(zalgoRegex, "");
}

function decodeHtmlEntities(text: string): string {
  const entityMap: { [key: string]: string } = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  
  return text.replace(/&[#\w]+;/g, (entity) => {
    return entityMap[entity] || entity;
  });
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  let cleanText = html.replace(/<[^>]*>/g, "");

  cleanText = decodeHtmlEntities(cleanText);

  cleanText = removeZalgoText(cleanText);

  cleanText = cleanText.replace(/\s+/g, " ").trim();

  if (!cleanText || cleanText.length === 0) {
    return "";
  }

  return cleanText;
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
