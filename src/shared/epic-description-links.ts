const EPIC_STORE_URL = "https://store.epicgames.com/";

export function resolveEpicDescriptionLink(href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;

  try {
    const url = new URL(value, EPIC_STORE_URL);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

interface DescriptionLinkClickEvent {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault(): void;
}

export function handleEpicDescriptionLinkClick(
  event: DescriptionLinkClickEvent,
  openExternal: (url: string) => Promise<void>
): void {
  const target = event.target as Element | null;
  const container = event.currentTarget as Element | null;
  const anchor = target?.closest?.("a[href]");

  if (!anchor || !container?.contains(anchor)) return;

  event.preventDefault();
  const url = resolveEpicDescriptionLink(anchor.getAttribute("href") ?? "");
  if (url) void openExternal(url);
}
