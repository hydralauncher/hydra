import { format } from "date-fns";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import Color from "color";
import { useDownload } from "@renderer/hooks";
import { HeroPanelActions } from "./hero-panel-actions";
import * as styles from "./hero-panel.css";
import { HeroPanelPlaytime } from "./hero-panel-playtime";
import { gameDetailsContext } from "../game-details.context";

export function HeroPanel() {
  const { t } = useTranslation("game_details");

  const { game, repacks, gameColor } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.status === "active" && lastPacket?.game.id === game?.id;

  const getInfo = () => {
    if (!game) {
      const [latestRepack] = repacks;

      if (latestRepack) {
        const lastUpdate = format(latestRepack.uploadDate!, "dd/MM/yyyy");
        const repacksCount = repacks.length;

        return (
          <>
            <p>{t("updated_at", { updated_at: lastUpdate })}</p>
            <p>{t("download_options", { count: repacksCount })}</p>
          </>
        );
      }

      return <p>{t("no_downloads")}</p>;
    }

    return <HeroPanelPlaytime />;
  };

  const backgroundColor = gameColor
    ? (new Color(gameColor).darken(0.6).toString() as string)
    : "";

  const showProgressBar =
    (game?.status === "active" && game?.progress < 1) ||
    game?.status === "paused";

  return (
    <>
      <div style={{ backgroundColor }} className={styles.panel}>
        <div className={styles.content}>{getInfo()}</div>
        <div className={styles.actions}>
          <HeroPanelActions />
        </div>

        {showProgressBar && (
          <progress
            max={1}
            value={
              isGameDownloading ? lastPacket?.game.progress : game?.progress
            }
            className={styles.progressBar({
              disabled: game?.status === "paused",
            })}
          />
        )}
      </div>
    </>
  );
}
