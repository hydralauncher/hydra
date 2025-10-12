function removeZalgoText(text: string): string {
  // Match combining characters that are commonly used in Zalgo text
  // Using a more explicit approach to avoid misleading-character-class warning
  const combiningMarks = [
    /\u0300-\u036F/g, // Combining Diacritical Marks
    /\u1AB0-\u1AFF/g, // Combining Diacritical Marks Extended
    /\u1DC0-\u1DFF/g, // Combining Diacritical Marks Supplement
    /\u20D0-\u20FF/g, // Combining Diacritical Marks for Symbols
    /\uFE20-\uFE2F/g, // Combining Half Marks
  ];

  let result = text;
  for (const regex of combiningMarks) {
    result = result.replace(regex, "");
  }
  return result;
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  const disallowedSelectors = [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
  ];
  for (const sel of disallowedSelectors) {
    for (const el of tempDiv.querySelectorAll(sel)) {
      el.remove();
    }
  }

  for (const el of tempDiv.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "src" ||
        name === "href"
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const value = textNode.nodeValue || "";
    textNode.nodeValue = removeZalgoText(value);
  }

  const cleanHtml = tempDiv.innerHTML.trim();
  return cleanHtml;
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
