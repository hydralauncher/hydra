import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Gamepad2 } from "lucide-react";

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
    unmatchedFiles: string[];
  }) => void;
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
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

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
            setUnmatchedFiles(payload.unmatchedFiles ?? []);
            onComplete({
              fileCount: payload.fileCount,
              sizeBytes: payload.sizeBytes,
              matched: payload.matched,
              unmatched: payload.unmatched,
              unmatchedFiles: payload.unmatchedFiles ?? [],
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

  const indeterminate = phase !== "done" && (total === 0 || processed >= total);

  const phaseLabel =
    phase === "done"
      ? t("setup_scan_complete")
      : phase === "scanning"
        ? t("setup_scanning")
        : t("setup_matching");

  const isDone = phase === "done";

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_scan_title", { system: systemLabel })}
      </h3>
      <p className="setup-modal__body-intro">{t("setup_scan_intro")}</p>

      <div className="setup-modal__progress-meta">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {!isDone && <SyncIcon size={14} className="setup-modal__spin" />}
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
          className={`setup-modal__progress-fill${
            indeterminate ? " setup-modal__progress-fill--indeterminate" : ""
          }`}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>

      {!isDone && currentFile && (
        <div className="setup-modal__scan-file">
          <FileDirectoryIcon
            size={14}
            className="setup-modal__scan-file-icon"
          />
          <span className="setup-modal__scan-file-name">{currentFile}</span>
          {currentStatus && (
            <span
              className={`setup-modal__scan-file-status setup-modal__scan-file-status--${currentStatus}`}
            >
              {`→ ${
                currentStatus === "matched"
                  ? t("setup_match_matched")
                  : t("setup_match_unmatched")
              }`}
            </span>
          )}
        </div>
      )}

      <div className="setup-modal__stats">
        <div className="setup-modal__stat">
          <span className="setup-modal__stat-icon">
            <Gamepad2 size={16} />
          </span>
          <span className="setup-modal__stat-label">{t("stat_games")}</span>
          <span className="setup-modal__stat-value">
            {phase === "matching" || phase === "done" ? matched : accFiles}
          </span>
        </div>
        <div className="setup-modal__stat">
          <span className="setup-modal__stat-icon">
            <DatabaseIcon size={16} />
          </span>
          <span className="setup-modal__stat-label">{t("stat_storage")}</span>
          <span className="setup-modal__stat-value">
            {formatBytes(accBytes)}
          </span>
        </div>
      </div>

      {isDone && unmatchedFiles.length > 0 && (
        <div className="setup-modal__unmatched">
          <button
            type="button"
            className="setup-modal__unmatched-header"
            onClick={() => setUnmatchedOpen((prev) => !prev)}
            aria-expanded={unmatchedOpen}
          >
            {unmatchedOpen ? (
              <ChevronDownIcon size={14} />
            ) : (
              <ChevronRightIcon size={14} />
            )}
            <span className="setup-modal__unmatched-title">
              {t("setup_unmatched_title", { count: unmatchedFiles.length })}
            </span>
          </button>
          {unmatchedOpen && (
            <ul className="setup-modal__unmatched-list">
              {unmatchedFiles.map((file, index) => (
                <li
                  key={`${file}-${index}`}
                  className="setup-modal__unmatched-item"
                >
                  <FileDirectoryIcon
                    size={14}
                    className="setup-modal__unmatched-icon"
                  />
                  <span className="setup-modal__unmatched-name">{file}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isDone && (
        <p className="setup-modal__scan-keep-open">
          {t("setup_scan_keep_open")}
        </p>
      )}
    </>
  );
}
