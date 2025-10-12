function removeZalgoText(text: string): string {
  const zalgoRegex =
    // eslint-disable-next-line no-misleading-character-class
    /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

  return text.replaceAll(zalgoRegex, "");
}



export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  // Use DOM-based sanitization to preserve safe formatting while removing dangerous content.
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // Remove clearly unsafe elements entirely.
  const disallowedSelectors = [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
  ];
  disallowedSelectors.forEach((sel) => {
    tempDiv.querySelectorAll(sel).forEach((el) => el.remove());
  });

  // Strip potentially dangerous attributes from remaining elements.
  tempDiv.querySelectorAll("*").forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") || // Event handlers
        name === "style" ||
        name === "src" ||
        name === "href" // Links disabled in editor; avoid javascript: URLs
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // Clean Zalgo text characters within text nodes.
  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
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
