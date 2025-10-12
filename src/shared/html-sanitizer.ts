function removeZalgoText(text: string): string {
  // Match combining characters that are commonly used in Zalgo text
  // Using alternation instead of character class to avoid misleading-character-class warning
  const zalgoRegex =
    /(\u0300-\u036F|\u1AB0-\u1AFF|\u1DC0-\u1DFF|\u20D0-\u20FF|\uFE20-\uFE2F)/g;

  return text.replaceAll(zalgoRegex, "");
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
