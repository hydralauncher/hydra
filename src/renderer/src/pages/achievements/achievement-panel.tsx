import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useDate, useDownload } from "@renderer/hooks";

import * as styles from "./achievement-panel.css";

import { gameDetailsContext } from "@renderer/context";

export interface HeroPanelProps {
  isHeaderStuck: boolean;
}

export function AchievementPanel({ isHeaderStuck }: HeroPanelProps) {
  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();

  const { game, repacks, gameColor } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.status === "active" && lastPacket?.game.id === game?.id;

  const showProgressBar =
    (game?.status === "active" && game?.progress < 1) ||
    game?.status === "paused";

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.content}>Teste 123131312</div>
      </div>
    </>
  );
}
