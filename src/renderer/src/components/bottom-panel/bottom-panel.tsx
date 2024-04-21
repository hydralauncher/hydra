import { useTranslation } from "react-i18next";

import { useDownload } from "@renderer/hooks";

import * as styles from "./bottom-panel.css";
import { vars } from "../../theme.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { game, progress, downloadSpeed, eta, isDownloading } = useDownload();

  const [version, setVersion] = useState("");

  useEffect(() => {
    window.electron.getVersion().then((result) => setVersion(result));
  }, []);

  const status = useMemo(() => {
    if (isDownloading) {
      if (game.status === "downloading_metadata")
        return t("downloading_metadata", { title: game.title });

      if (game.status === "checking_files")
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
  }, [t, game, progress, eta, isDownloading, downloadSpeed]);

  return (
    <footer
      className={styles.bottomPanel}
      style={{
        background: isDownloading
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
        v{version} "{VERSION_CODENAME}"
      </small>
    </footer>
  );
}
