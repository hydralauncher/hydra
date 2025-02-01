import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDownload, useLibrary, useUserDetails } from "@renderer/hooks";

import "./bottom-panel.scss";

import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { userDetails } = useUserDetails();

  const { library } = useLibrary();

  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const isGameDownloading = !!lastPacket;

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
      const game = library.find((game) => game.id === lastPacket?.gameId)!;

      if (lastPacket?.isCheckingFiles)
        return t("checking_files", {
          title: game.title,
          percentage: progress,
        });

      if (lastPacket?.isDownloadingMetadata)
        return t("downloading_metadata", {
          title: game.title,
          percentage: progress,
        });

      if (!eta) {
        return t("calculating_eta", {
          title: game.title,
          percentage: progress,
        });
      }

      return t("downloading", {
        title: game.title,
        percentage: progress,
        eta,
        speed: downloadSpeed,
      });
    }

    return t("no_downloads_in_progress");
  }, [t, isGameDownloading, library, lastPacket, progress, eta, downloadSpeed]);

  return (
    <footer className="bottom-panel">
      <button
        type="button"
        className="bottom-panel__downloads-button"
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
