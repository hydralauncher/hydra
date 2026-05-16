import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, SyncIcon, XIcon } from "@primer/octicons-react";

import type { EmulatorSystem } from "@types";

import type { PendingFolder } from "./types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  folders: PendingFolder[];
  onComplete: (added: {
    fileCount: number;
    sizeBytes: number;
    matched: number;
    unmatched: number;
  }) => void;
  onCancel: () => void;
}

type Phase = "scanning" | "matching" | "done";

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export function SetupStepScanning({
  system,
  systemLabel,
  folders,
  onComplete,
  onCancel,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation("settings");

  const [phase, setPhase] = useState<Phase>("scanning");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<
    "matched" | "unmatched" | null
  >(null);
  const [matched, setMatched] = useState(0);
  const [accFiles, setAccFiles] = useState(0);
  const [accBytes, setAccBytes] = useState(0);

  const requestIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const language = i18n.language.split("-")[0] || "en";

    (async () => {
      const { requestId } = await window.electron.importLaunchboxRoms(
        system,
        folders.map((f) => ({
          path: f.path,
          scanSubfolders: f.scanSubfolders,
        })),
        language
      );
      if (cancelled) {
        window.electron.cancelLaunchboxImport(requestId);
        return;
      }
      requestIdRef.current = requestId;

      const unsub = window.electron.onLaunchboxImportProgress(
        requestId,
        (payload) => {
          if (payload.type === "scan_progress") {
            setPhase("scanning");
            setProcessed(payload.processed);
            setTotal(payload.total);
            setCurrentFile(payload.currentFile);
            setCurrentStatus(null);
          } else if (payload.type === "match_progress") {
            setPhase("matching");
            setProcessed(payload.processed);
            setTotal(payload.total);
            setCurrentFile(payload.currentFile);
            setCurrentStatus(payload.status);
            setMatched(payload.matched);
            setAccFiles(payload.fileCount);
            setAccBytes(payload.sizeBytes);
          } else if (payload.type === "done") {
            unsub();
            setPhase("done");
            onComplete({
              fileCount: payload.fileCount,
              sizeBytes: payload.sizeBytes,
              matched: payload.matched,
              unmatched: payload.unmatched,
            });
          } else if (payload.type === "cancelled") {
            unsub();
          } else {
            unsub();
          }
        }
      );
      unsubRef.current = unsub;
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      if (requestIdRef.current) {
        window.electron.cancelLaunchboxImport(requestIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const phaseLabel =
    phase === "scanning" ? t("setup_scanning") : t("setup_matching");

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_scan_title", { system: systemLabel })}
      </h3>
      <p className="setup-modal__body-intro">{t("setup_scan_intro")}</p>

      <div className="setup-modal__progress-meta">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <SyncIcon size={14} />
          <span>{phaseLabel}</span>
        </span>
        <span>
          {t("setup_scan_count", {
            processed,
            total: Math.max(total, processed),
          })}
        </span>
      </div>

      <div className="setup-modal__progress-bar">
        <div
          className="setup-modal__progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      {currentFile && (
        <p className="setup-modal__current-file">
          <span>{currentFile}</span>
          {currentStatus && (
            <span
              className={`setup-modal__match-tag setup-modal__match-tag--${currentStatus}`}
            >
              {currentStatus === "matched" ? (
                <CheckIcon size={11} />
              ) : (
                <XIcon size={11} />
              )}
              <span>
                {currentStatus === "matched"
                  ? t("setup_match_matched")
                  : t("setup_match_unmatched")}
              </span>
            </span>
          )}
        </p>
      )}

      <div className="setup-modal__stats">
        <div className="setup-modal__stat">
          <span className="setup-modal__stat-label">{t("stat_games")}</span>
          <span className="setup-modal__stat-value">
            {phase === "matching" || phase === "done" ? matched : accFiles}
          </span>
        </div>
        <div className="setup-modal__stat">
          <span className="setup-modal__stat-label">{t("stat_storage")}</span>
          <span className="setup-modal__stat-value">
            {formatBytes(accBytes)}
          </span>
        </div>
      </div>

      <p className="setup-modal__body-intro" style={{ fontSize: 12 }}>
        {t("setup_scan_keep_open")}
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="setup-modal__ghost-button"
          onClick={onCancel}
        >
          {t("setup_cancel_scan")}
        </button>
      </div>
    </>
  );
}
