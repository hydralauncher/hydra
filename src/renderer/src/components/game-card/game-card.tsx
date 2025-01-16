import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import type { GameStats } from "@types";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";

import "./game-card.scss";

import { useTranslation } from "react-i18next";
import { Badge } from "../badge/badge";
import { useCallback, useState } from "react";
import { useFormat, useRepacks } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";

export interface GameCardProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  game: any;
}

const shopIcon = {
  steam: <SteamLogo className="game-card__shop-icon" />,
};

export function GameCard({ game, ...props }: GameCardProps) {
  const { t } = useTranslation("game_card");

  const [stats, setStats] = useState<GameStats | null>(null);

  const { getRepacksForObjectId } = useRepacks();
  const repacks = getRepacksForObjectId(game.objectId);

  const uniqueRepackers = Array.from(
    new Set(repacks.map((repack) => repack.repacker))
  );

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((stats) => {
        setStats(stats);
      });
    }
  }, [game, stats]);

  const { numberFormatter } = useFormat();

  return (
    <button
      {...props}
      type="button"
      className="game-card"
      onMouseEnter={handleHover}
    >
      <div className="game-card__backdrop">
        <img
          src={steamUrlBuilder.library(game.objectId)}
          alt={game.title}
          className="game-card__cover"
          loading="lazy"
        />

        <div className="game-card__content">
          <div className="game-card__title-container">
            {shopIcon[game.shop]}
            <p className="game-card__title">{game.title}</p>
          </div>

          {uniqueRepackers.length > 0 ? (
            <ul className="game-card__download-options">
              {uniqueRepackers.map((repacker) => (
                <li key={repacker}>
                  <Badge>{repacker}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="game-card__no-download-label">{t("no_downloads")}</p>
          )}
          <div className="game-card__specifics">
            <div className="game-card__specifics-item">
              <DownloadIcon />
              <span>
                {stats ? numberFormatter.format(stats.downloadCount) : "…"}
              </span>
            </div>

            <div className="game-card__specifics-item">
              <PeopleIcon />
              <span>
                {stats ? numberFormatter.format(stats?.playerCount) : "…"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
