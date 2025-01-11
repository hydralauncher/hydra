import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import type { GameStats } from "@types";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";

import * as styles from "./game-card.css";
import { useTranslation } from "react-i18next";
import { Badge } from "../badge/badge";
import { useCallback, useState } from "react";
import { useFormat, useRepacks } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useMemo } from "react";

export interface GameCardProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  game: any;
}

const shopIcon = {
  steam: <SteamLogo className={styles.shopIcon} />,
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

  const firstThreeRepackers = useMemo(() => uniqueRepackers.slice(0, 3), [uniqueRepackers]);
  const remainingCount = useMemo(() => uniqueRepackers.length - 3, [uniqueRepackers]);

  return (
    <button
      {...props}
      type="button"
      className={styles.card}
      onMouseEnter={handleHover}
    >
      <div className={styles.backdrop}>
        <img
          src={steamUrlBuilder.library(game.objectId)}
          alt={game.title}
          className={styles.cover}
          loading="lazy"
        />

        <div className={styles.content}>
          <div className={styles.titleContainer}>
            {shopIcon[game.shop]}
            <p className={styles.title}>{game.title}</p>
          </div>

          <div className={styles.downloadOptions}>
            {uniqueRepackers.length > 0 ? (
              <>
                {firstThreeRepackers.map((repacker) => (
                  <Badge key={repacker}>{repacker}</Badge>
                ))}
                {remainingCount > 0 && (
                  <Badge>+{remainingCount} {t("available")}</Badge>
                )}
              </>
            ) : (
              <p className={styles.noDownloadsLabel}>{t("no_downloads")}</p>
            )}
          </div>

          <div className={styles.specifics}>
            <div className={styles.specificsItem}>
              <DownloadIcon />
              <span>
                {stats ? numberFormatter.format(stats.downloadCount) : "…"}
              </span>
            </div>

            <div className={styles.specificsItem}>
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
