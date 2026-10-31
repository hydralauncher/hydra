import sharp from "sharp";

// Twice the 16px overlay slot, so Windows scales it down cleanly on high-DPI
// taskbars instead of blowing up a small bitmap.
export const CHAT_BADGE_SIZE = 32;
const MAX_LABELLED_COUNT = 9;
// $error-color, the same red as the sidebar unread dot.
const BADGE_COLOR = "#e11d48";

/** Badge text for an unread count; null when there is nothing to show. */
export const getChatBadgeLabel = (count: number) => {
  if (count <= 0) return null;
  return count > MAX_LABELLED_COUNT ? `${MAX_LABELLED_COUNT}+` : String(count);
};

/** Renders the badge as a PNG for a taskbar overlay icon. */
export const renderChatBadge = (label: string) => {
  const center = CHAT_BADGE_SIZE / 2;
  const fontSize = label.length > 1 ? 16 : 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHAT_BADGE_SIZE}" height="${CHAT_BADGE_SIZE}">
    <circle cx="${center}" cy="${center}" r="${center}" fill="${BADGE_COLOR}"/>
    <text x="${center}" y="${center}" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${label}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
};
