import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import "./bottom-panel.scss";

import { useNavigate } from "react-router-dom";
import { VERSION_CODENAME } from "@renderer/constants";
import {
  DownloadIcon,
  FileZipIcon,
  HorizontalRuleIcon,
  SearchIcon,
  SyncIcon,
  ToolsIcon,
} from "@primer/octicons-react";
import { Upload } from "lucide-react";
import { formatBytes } from "@shared";
import type { AppUpdaterEvent, SeedingStatus } from "@types";
import { SeedingHoverCard } from "./seeding-hover-card";
import { UpdateModal } from "./update-modal";

type ActivityType =
  | "downloading"
  | "extracting"
  | "checking"
  | "metadata"
  | "redist"
  | "idle";

export function BottomPanel() {
  const { t } = useTranslation("bottom_panel");

  const navigate = useNavigate();

  const { userDetails } = useUserDetails();

  const { library } = useLibrary();

  const { showSuccessToast } = useToast();

  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const extraction = useAppSelector((state) => state.download.extraction);

  const [version, setVersion] = useState("");
  const [sessionHash, setSessionHash] = useState<null | string>("");
  const [commonRedistStatus, setCommonRedistStatus] = useState<string | null>(
    null
  );

  const [hasUpdate, setHasUpdate] = useState(false);
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);
  const [showSeedingCard, setShowSeedingCard] = useState(false);
  const [seedingCardPosition, setSeedingCardPosition] = useState({
    x: 0,
    y: 0,
  });
  const seedingButtonRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    const unlisten = window.electron.onSeedingStatus((status) => {
      setSeedingStatus(status);
    });

    return () => unlisten();
  }, []);

  useEffect(() => {
    const unlisten = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type === "update-available") {
          setHasUpdate(true);
        }

        if (event.type === "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    window.electron.checkForUpdates();

    return () => unlisten();
  }, []);

  const totalUploadSpeed = useMemo(
    () => seedingStatus.reduce((acc, s) => acc + s.uploadSpeed, 0),
    [seedingStatus]
  );

  const handleSeedingMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    hoverTimerRef.current = setTimeout(() => {
      if (seedingButtonRef.current) {
        const rect = seedingButtonRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const bottomY = window.innerHeight - rect.top + 8;
        setSeedingCardPosition({
          x: centerX,
          y: bottomY,
        });
      }
      setShowSeedingCard(true);
    }, 300);
  }, []);

  const handleSeedingMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    hoverTimerRef.current = setTimeout(() => {
      setShowSeedingCard(false);
    }, 200);
  }, []);

  const activityInfo = useMemo(() => {
    if (commonRedistStatus) {
      return {
        type: "redist" as ActivityType,
        label: t("installing_common_redist", { log: commonRedistStatus }),
        progress: null,
        percentage: null,
        speed: null,
        eta: null,
      };
    }

    if (extraction) {
      const extractingGame = library.find(
        (game) => game.id === extraction.visibleId
      );

      if (extractingGame) {
        const pct = Math.round(extraction.progress * 100);
        return {
          type: "extracting" as ActivityType,
          label: extractingGame.title,
          progress: extraction.progress,
          percentage: `${pct}%`,
          speed: null,
          eta: null,
        };
      }
    }

    const game = lastPacket
      ? library.find((game) => game.id === lastPacket?.gameId)
      : undefined;

    if (game) {
      if (lastPacket?.isCheckingFiles) {
        return {
          type: "checking" as ActivityType,
          label: game.title,
          progress: lastPacket.progress,
          percentage: progress,
          speed: null,
          eta: null,
        };
      }

      if (lastPacket?.isDownloadingMetadata) {
        return {
          type: "metadata" as ActivityType,
          label: game.title,
          progress: lastPacket.progress,
          percentage: progress,
          speed: null,
          eta: null,
        };
      }

      return {
        type: "downloading" as ActivityType,
        label: game.title,
        progress: lastPacket?.progress ?? 0,
        percentage: progress,
        speed: downloadSpeed,
        eta,
      };
    }

    return {
      type: "idle" as ActivityType,
      label: t("no_downloads_in_progress"),
      progress: null,
      percentage: null,
      speed: null,
      eta: null,
    };
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

  const renderIcon = () => {
    switch (activityInfo.type) {
      case "downloading":
      case "metadata":
        return <DownloadIcon size={14} />;
      case "extracting":
        return <FileZipIcon size={14} />;
      case "checking":
        return <SearchIcon size={14} />;
      case "redist":
        return <ToolsIcon size={14} />;
      default:
        return <HorizontalRuleIcon size={14} />;
    }
  };

  const isActive = activityInfo.type !== "idle";
  const hasProgress = activityInfo.progress !== null;

  const progressColorClass = (() => {
    switch (activityInfo.type) {
      case "extracting":
        return "bottom-panel__progress-fill--extraction";
      case "checking":
      case "metadata":
        return "bottom-panel__progress-fill--checking";
      case "redist":
        return "bottom-panel__progress-fill--redist";
      default:
        return "";
    }
  })();

  const iconColorClass = (() => {
    if (!isActive) return "";
    switch (activityInfo.type) {
      case "extracting":
        return "bottom-panel__icon--extracting";
      case "checking":
      case "metadata":
        return "bottom-panel__icon--checking";
      case "redist":
        return "bottom-panel__icon--redist";
      default:
        return "";
    }
  })();

  return (
    <footer className="bottom-panel">
      {hasProgress && (
        <div
          className={`bottom-panel__progress-fill ${progressColorClass}`}
          style={{ width: `${activityInfo.progress! * 100}%` }}
        />
      )}

      <button
        type="button"
        className="bottom-panel__downloads-button"
        onClick={() => navigate("/downloads")}
      >
        <div
          className={`bottom-panel__icon ${isActive ? "bottom-panel__icon--active" : ""} ${iconColorClass}`}
        >
          {renderIcon()}
        </div>

        <small className="bottom-panel__label">{activityInfo.label}</small>

        {activityInfo.percentage && (
          <small className="bottom-panel__percentage">
            {activityInfo.percentage}
          </small>
        )}

        {activityInfo.speed && (
          <small className="bottom-panel__speed">{activityInfo.speed}</small>
        )}

        {activityInfo.eta && (
          <small className="bottom-panel__eta">{activityInfo.eta}</small>
        )}
      </button>

      {seedingStatus.length > 0 && totalUploadSpeed > 0 && (
        <>
          <button
            ref={seedingButtonRef}
            type="button"
            className="bottom-panel__seeding-button"
            onClick={() => navigate("/downloads")}
            onMouseEnter={handleSeedingMouseEnter}
            onMouseLeave={handleSeedingMouseLeave}
          >
            <div className="bottom-panel__seeding-icon">
              <Upload size={14} />
            </div>
            <small className="bottom-panel__seeding-speed">
              {formatBytes(totalUploadSpeed)}/s
            </small>
          </button>

          {showSeedingCard && (
            <SeedingHoverCard
              seedingStatus={seedingStatus}
              library={library}
              position={seedingCardPosition}
              onMouseEnter={handleSeedingMouseEnter}
              onMouseLeave={handleSeedingMouseLeave}
            />
          )}
        </>
      )}

      <button
        type="button"
        className="bottom-panel__version-button"
        onClick={() => setShowUpdateModal(true)}
      >
        {(hasUpdate || isReadyToInstall) && (
          <div className="bottom-panel__update-icon">
            <SyncIcon size={12} />
          </div>
        )}
        <small>
          {sessionHash ? `${sessionHash} -` : ""} v{version} &quot;
          {VERSION_CODENAME}&quot;
        </small>
      </button>

      <UpdateModal
        visible={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
      />
    </footer>
  );
}
