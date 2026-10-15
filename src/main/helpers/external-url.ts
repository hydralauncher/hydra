// Renderers may only open web pages in the browser. Other schemes (file:,
// custom app protocols) can start programs, and some links come from other
// users, such as the ones in chat messages.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** The normalized address when `value` is an http or https URL, else null. */
export const parseExternalUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
