import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import "./bottom-panel.scss";

import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { userDetails } = useUserDetails();

  const { library } = useLibrary();

  const { showSuccessToast } = useToast();

  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const [version, setVersion] = useState("");
  const [sessionHash, setSessionHash] = useState<null | string>("");
  const [commonRedistStatus, setCommonRedistStatus] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (window.electron) {
      window.electron.getVersion().then((result) => setVersion(result));
    }
  }, []);

  useEffect(() => {
    if (!window.electron) return;

    const unlisten = window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setCommonRedistStatus(null);

          if (complete) {
            showSuccessToast(
              t("installation_complete"),
              t("installation_complete_message")
            );
          }

          return;
        }

        setCommonRedistStatus(log);
      }
    );

    return () => unlisten();
  }, [t, showSuccessToast]);

  useEffect(() => {
    if (window.electron) {
      window.electron.getSessionHash().then((result) => setSessionHash(result));
    }
  }, [userDetails?.id]);

  const status = useMemo(() => {
    if (commonRedistStatus) {
      return t("installing_common_redist", { log: commonRedistStatus });
    }

    const game = lastPacket
      ? library.find((game) => game.id === lastPacket?.gameId)
      : undefined;

    if (game) {
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
  }, [
    t,
    library,
    lastPacket,
    progress,
    eta,
    downloadSpeed,
    commonRedistStatus,
  ]);

  return (
    <footer className="bottom-panel">
      <button
        type="button"
        className="bottom-panel__downloads-button"
        onClick={() => navigate("/downloads")}
      >
        <small>{status}</small>
      </button>

      <button
        data-featurebase-changelog
        className="bottom-panel__version-button"
      >
        <small data-featurebase-changelog>
          {sessionHash ? `${sessionHash} -` : ""} v{version} &quot;
          {VERSION_CODENAME}&quot;
        </small>
      </button>
    </footer>
  );
}
