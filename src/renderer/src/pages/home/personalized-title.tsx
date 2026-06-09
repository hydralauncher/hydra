/* Personalized row title. Renders an icon of one of the user's
   previously-played games next to copy that references it — used to
   replace the generic "emoji + Genre" header on genre rows when the
   user has at least one library entry matching that genre. Gives the
   home page a "Hydra remembers what you play" feel without changing
   the row content itself. */

import type { LibraryGame } from "@types";
import { useTranslation } from "react-i18next";

import "./personalized-title.scss";

interface PersonalizedTitleProps {
  /** The library game whose icon + title seed this row. */
  game: Pick<
    LibraryGame,
    "title" | "iconUrl" | "customIconUrl" | "logoImageUrl"
  >;
  /** Which translation key to use for the prefix copy. Defaults to
   *  `because_you_played_prefix` for backwards compat (every call
   *  site that existed before this prop was added used that key).
   *  The "Because you love X" rows pass `because_you_love_prefix`. */
  prefixKey?: string;
}

const resolveIcon = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  )
    return trimmed;
  if (trimmed.startsWith("local:"))
    return `local:${trimmed.slice("local:".length).replaceAll("\\", "/")}`;
  const n = trimmed.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(n) || n.startsWith("/")) return `local:${n}`;
  return n;
};

export function PersonalizedTitle({
  game,
  prefixKey = "because_you_played_prefix",
}: PersonalizedTitleProps) {
  const { t } = useTranslation("home");
  /* Prefer the user's custom icon if they've overridden it, fall back
     to the native iconUrl. (logoImageUrl is intentionally NOT used
     because it's the transparent text-only Steam logo, which reads
     poorly at this small size.) */
  const iconSrc = resolveIcon(game.customIconUrl ?? game.iconUrl);

  /* Render the prefix copy, then the game's icon, then the game's
     name — so the icon visually anchors the title rather than sitting
     detached at the start of the row. Pattern: "Because you played
     [icon] Cyberpunk 2077". */
  return (
    <span className="personalized-title">
      <span className="personalized-title__text">{t(prefixKey)}</span>
      {iconSrc && (
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          className="personalized-title__icon"
          loading="lazy"
        />
      )}
      <span className="personalized-title__text personalized-title__text--game">
        {game.title}
      </span>
    </span>
  );
}
