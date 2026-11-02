import { removeZalgoText } from "./html-sanitizer";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const COMMENT_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
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
]);

const COMMENT_DROPPED_TAGS = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "select",
  "head",
]);

const isElement = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE;

const isAllowedCommentElement = (element: Element) =>
  element.namespaceURI === HTML_NAMESPACE &&
  COMMENT_ALLOWED_TAGS.has(element.localName);

const copyAllowedCommentNodes = (
  source: Node,
  target: Node,
  document: Document
) => {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(
        document.createTextNode(removeZalgoText(child.textContent ?? ""))
      );
      continue;
    }

    if (!isElement(child) || COMMENT_DROPPED_TAGS.has(child.localName)) {
      continue;
    }

    if (!isAllowedCommentElement(child)) {
      copyAllowedCommentNodes(child, target, document);
      continue;
    }

    const copy = document.createElement(child.localName);
    copyAllowedCommentNodes(child, copy, document);
    target.appendChild(copy);
  }
};

export const sanitizeCommentHtml = (html: string) => {
  if (!html) return "";

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const container = parsed.createElement("div");
  copyAllowedCommentNodes(parsed.body, container, parsed);
  return container.innerHTML.trim();
};
