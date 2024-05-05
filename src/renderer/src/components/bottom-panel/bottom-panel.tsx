import { useTranslation } from "react-i18next";

import { useDownload } from "@renderer/hooks";

import * as styles from "./bottom-panel.css";
import { vars } from "../../theme.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";
import { GameStatus, GameStatusHelper } from "@shared";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { game, progress, downloadSpeed, eta } = useDownload();

  const isGameDownloading =
    game && GameStatusHelper.isDownloading(game.status ?? null);

  const [version, setVersion] = useState("");

  useEffect(() => {
    window.electron.getVersion().then((result) => setVersion(result));
  }, []);

  const status = useMemo(() => {
    if (isGameDownloading) {
      if (game.status === GameStatus.DownloadingMetadata)
        return t("downloading_metadata", { title: game.title });

      if (game.status === GameStatus.CheckingFiles)
        return t("checking_files", {
          title: game.title,
          percentage: progress,
        });

      return t("downloading", {
        title: game?.title,
        percentage: progress,
        eta,
        speed: downloadSpeed,
      });
    }

    return t("no_downloads_in_progress");
  }, [t, isGameDownloading, game, progress, eta, downloadSpeed]);

  return (
    <footer
      className={styles.bottomPanel}
      style={{
        background: isGameDownloading
          ? `linear-gradient(90deg, ${vars.color.background} ${progress}, ${vars.color.darkBackground} ${progress})`
          : vars.color.darkBackground,
      }}
    >
      <button
        type="button"
        className={styles.downloadsButton}
        onClick={() => navigate("/downloads")}
      >
        <small>{status}</small>
      </button>

      <small>
        v{version} &quot;{VERSION_CODENAME}&quot;
      </small>
    </footer>
  );
}
