import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommentDiscussionIcon } from "@primer/octicons-react";

import {
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import "./bottom-panel.scss";

import { useNavigate } from "react-router-dom";

export function BottomPanel() {
  const { t } = useTranslation(["bottom_panel", "sidebar"]);

  const navigate = useNavigate();

  const { userDetails, hasActiveSubscription } = useUserDetails();

  const { library } = useLibrary();

  const { showSuccessToast } = useToast();

  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const extraction = useAppSelector((state) => state.download.extraction);

  const [version, setVersion] = useState("");
  const [sessionHash, setSessionHash] = useState<null | string>("");
  const [commonRedistStatus, setCommonRedistStatus] = useState<string | null>(
    null
  );

  useEffect(() => {
    window.electron.getVersion().then((result) => setVersion(result));
  }, []);

  useEffect(() => {
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
    window.electron.getSessionHash().then((result) => setSessionHash(result));
  }, [userDetails?.id]);

  const status = useMemo(() => {
    if (commonRedistStatus) {
      return t("installing_common_redist", { log: commonRedistStatus });
    }

    if (extraction) {
      const extractingGame = library.find(
        (game) => game.id === extraction.visibleId
      );

      if (extractingGame) {
        const extractionPercentage = Math.round(extraction.progress * 100);
        return t("extracting", {
          title: extractingGame.title,
          percentage: `${extractionPercentage}%`,
        });
      }
    }

    const game = lastPacket
      ? library.find((game) => game.id === lastPacket?.gameId)
      : undefined;

    if (game) {
      if (lastPacket?.isRecovering)
        return t("recovering", {
          title: game.title,
          percentage: `${Math.round((lastPacket.recoveryProgress ?? 0) * 100)}%`,
        });

      if (lastPacket?.isReconnecting)
        return t("reconnecting", {
          title: game.title,
        });

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

      const hasBatchInfo =
        lastPacket?.batchFilesTotal != null && lastPacket.batchFilesTotal > 1;

      if (!eta) {
        if (hasBatchInfo) {
          return t("calculating_eta_batch", {
            title: game.title,
            percentage: progress,
            filesDownloaded: lastPacket!.batchFilesDownloaded ?? 0,
            filesTotal: lastPacket!.batchFilesTotal,
          });
        }
        return t("calculating_eta", {
          title: game.title,
          percentage: progress,
        });
      }

      if (hasBatchInfo) {
        return t("downloading_batch", {
          title: game.title,
          percentage: progress,
          eta,
          speed: downloadSpeed,
          filesDownloaded: lastPacket!.batchFilesDownloaded ?? 0,
          filesTotal: lastPacket!.batchFilesTotal,
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
    extraction,
  ]);

  return (
    <footer className="bottom-panel">
      <div className="bottom-panel__left">
        {hasActiveSubscription && (
          <button
            type="button"
            className="bottom-panel__help-button"
            data-open-support-chat
          >
            <svg
              width="0"
              height="0"
              aria-hidden="true"
              className="bottom-panel__gradient-defs"
            >
              <defs>
                <linearGradient
                  id="hydra-cloud-gradient"
                  x1="0%"
                  y1="100%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#16b195" />
                  <stop offset="100%" stopColor="#3e62c0" />
                </linearGradient>
              </defs>
            </svg>
            <CommentDiscussionIcon
              size={14}
              className="bottom-panel__help-icon"
            />
            <small>{t("need_help", { ns: "sidebar" })}</small>
          </button>
        )}
      </div>

      <div
        className={`bottom-panel__center${
          !userDetails || !hasActiveSubscription
            ? " bottom-panel__center--start"
            : ""
        }`}
      >
        <button
          type="button"
          className="bottom-panel__downloads-button"
          onClick={() => navigate("/downloads")}
        >
          <small>{status}</small>
        </button>
      </div>

      <div className="bottom-panel__right">
        <button
          data-open-workwonders-changelog-mini
          className="bottom-panel__version-button"
        >
          <small>
            {sessionHash ? `${sessionHash} -` : ""} v{version}
          </small>
        </button>
      </div>
    </footer>
  );
}
