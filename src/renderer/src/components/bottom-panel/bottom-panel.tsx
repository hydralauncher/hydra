import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDownload, useUserDetails } from "@renderer/hooks";

import * as styles from "./bottom-panel.css";

import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { userDetails } = useUserDetails();

  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const isGameDownloading = !!lastPacket?.game;

  const [version, setVersion] = useState("");
  const [sessionHash, setSessionHash] = useState<null | string>("");

  useEffect(() => {
    window.electron.getVersion().then((result) => setVersion(result));
  }, []);

  useEffect(() => {
    window.electron.getSessionHash().then((result) => setSessionHash(result));
  }, [userDetails?.id]);

  const status = useMemo(() => {
    if (isGameDownloading) {
      if (lastPacket?.isCheckingFiles)
        return t("checking_files", {
          title: lastPacket?.game.title,
          percentage: progress,
        });

      if (lastPacket?.isDownloadingMetadata)
        return t("downloading_metadata", {
          title: lastPacket?.game.title,
          percentage: progress,
        });

      if (!eta) {
        return t("calculating_eta", {
          title: lastPacket?.game.title,
          percentage: progress,
        });
      }

      return t("downloading", {
        title: lastPacket?.game.title,
        percentage: progress,
        eta,
        speed: downloadSpeed,
      });
    }

    return t("no_downloads_in_progress");
  }, [
    t,
    isGameDownloading,
    lastPacket?.game,
    lastPacket?.isDownloadingMetadata,
    lastPacket?.isCheckingFiles,
    progress,
    eta,
    downloadSpeed,
  ]);

  return (
    <footer className={styles.bottomPanel}>
      <button
        type="button"
        className={styles.downloadsButton}
        onClick={() => navigate("/downloads")}
      >
        <small>{status}</small>
      </button>

      <small>
        {sessionHash ? `${sessionHash} -` : ""} v{version} &quot;
        {VERSION_CODENAME}&quot;
      </small>
    </footer>
  );
}
