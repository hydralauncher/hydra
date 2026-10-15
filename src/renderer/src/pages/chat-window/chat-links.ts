export type ChatTextPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; url: string };

// Only web links become clickable; any other scheme stays plain text.
const LINK_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Punctuation that usually ends the sentence around a link, not the link.
const TRAILING_PUNCTUATION = new Set(".,;:!?*_~");
const OPENING_BRACKETS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

const countOf = (text: string, character: string) =>
  text.split(character).length - 1;

const trimTrailingPunctuation = (link: string) => {
  let end = link.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(link[end - 1])) end--;
  return link.slice(0, end);
};

const trimLinkEnd = (link: string): string => {
  const trimmed = trimTrailingPunctuation(link);
  const last = trimmed.at(-1) ?? "";
  const opening = OPENING_BRACKETS[last];

  // A closing bracket stays when the link opened it, as in
  // "https://en.wikipedia.org/wiki/Hydra_(genus)".
  if (opening && countOf(trimmed, last) > countOf(trimmed, opening)) {
    return trimLinkEnd(trimmed.slice(0, -1));
  }

  return trimmed;
};

/** The URL when `value` is an http or https address, else null. */
export const parseWebUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

/** Splits a message into plain text and the web links in it. */
export const splitMessageLinks = (text: string): ChatTextPart[] => {
  const parts: ChatTextPart[] = [];
  let index = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const link = trimLinkEnd(match[0]);
    const url = parseWebUrl(link);
    if (!url) continue;

    const start = match.index ?? 0;
    if (start > index) {
      parts.push({ type: "text", text: text.slice(index, start) });
    }

    parts.push({ type: "link", text: link, url: url.href });
    index = start + link.length;
  }

  if (index < text.length) {
    parts.push({ type: "text", text: text.slice(index) });
  }

  return parts;
};
