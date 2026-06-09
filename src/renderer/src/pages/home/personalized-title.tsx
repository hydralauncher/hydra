import type { LibraryGame } from "@types";
import { useTranslation } from "react-i18next";

import "./personalized-title.scss";

interface PersonalizedTitleProps {
  game: Pick<
    LibraryGame,
    "title" | "iconUrl" | "customIconUrl" | "logoImageUrl"
  >;
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
  const iconSrc = resolveIcon(game.customIconUrl ?? game.iconUrl);

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
