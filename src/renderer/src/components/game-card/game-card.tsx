import { DownloadIcon, FileDirectoryIcon } from "@primer/octicons-react";
import type { CatalogueEntry } from "@types";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicGamesLogo from "@renderer/assets/epic-games-logo.svg?react";

import * as styles from "./game-card.css";
import { useTranslation } from "react-i18next";

export interface GameCardProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  game: CatalogueEntry;
}

const shopIcon = {
  epic: <EpicGamesLogo className={styles.shopIcon} />,
  steam: <SteamLogo className={styles.shopIcon} />,
};

export function GameCard({ game, ...props }: GameCardProps) {
  const { t } = useTranslation("game_card");

  const uniqueRepackers = Array.from(
    new Set(game.repacks.map(({ repacker }) => repacker))
  );

  return (
    <button {...props} type="button" className={styles.card}>
      <div className={styles.backdrop}>
        <img src={game.cover} alt={game.title} className={styles.cover} />

        <div className={styles.content}>
          <div className={styles.titleContainer}>
            {shopIcon[game.shop]}
            <p className={styles.title}>{game.title}</p>
          </div>

          {uniqueRepackers.length > 0 ? (
            <ul className={styles.downloadOptions}>
              {uniqueRepackers.map((repacker) => (
                <li key={repacker} className={styles.downloadOption}>
                  <span>{repacker}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noDownloadsLabel}>{t("no_downloads")}</p>
          )}

          <div className={styles.specifics}>
            <div className={styles.specificsItem}>
              <DownloadIcon />
              <span>{game.repacks.length}</span>
            </div>

            {game.repacks.length > 0 && (
              <div className={styles.specificsItem}>
                <FileDirectoryIcon />
                <span>{game.repacks.at(0)?.fileSize}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
