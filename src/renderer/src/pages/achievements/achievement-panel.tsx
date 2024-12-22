import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";
import * as styles from "./achievement-panel.css";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";

export interface HeroPanelProps {
  isHeaderStuck: boolean;
}

export function AchievementPanel({ isHeaderStuck }: HeroPanelProps) {
  const { t } = useTranslation("game_details");

  const {} = useContext(gameDetailsContext);

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.content}>
          Pontos desbloqueados: <HydraIcon width={20} height={20} /> 69/420
        </div>
      </div>
    </>
  );
}
