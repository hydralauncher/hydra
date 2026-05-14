import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import type { EmulatorSystem } from "@types";

import type { PendingFolder } from "./types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  folders: PendingFolder[];
  onComplete: (added: { fileCount: number; sizeBytes: number }) => void;
  onCancel: () => void;
}

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
  const { t } = useTranslation("settings");

  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [accFiles, setAccFiles] = useState(0);
  const [accBytes, setAccBytes] = useState(0);

  const requestIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cumulativeFiles = 0;
    let cumulativeBytes = 0;
    let cumulativeProcessed = 0;
    let cumulativeTotal = 0;

    const runOne = async (folder: PendingFolder) => {
      const { requestId } = await window.electron.startRomScan(
        system,
        folder.path,
        folder.scanSubfolders
      );
      if (cancelled) {
        window.electron.cancelRomScan(requestId);
        return;
      }
      requestIdRef.current = requestId;

      return new Promise<{ fileCount: number; sizeBytes: number }>(
        (resolve, reject) => {
          const unsub = window.electron.onRomScanProgress(
            requestId,
            (payload) => {
              if (payload.type === "progress") {
                setProcessed(cumulativeProcessed + payload.processed);
                setTotal(cumulativeTotal + payload.total);
                setCurrentFile(payload.currentFile);
              } else if (payload.type === "done") {
                unsub();
                resolve({
                  fileCount: payload.fileCount,
                  sizeBytes: payload.sizeBytes,
                });
              } else if (payload.type === "cancelled") {
                unsub();
                resolve({
                  fileCount: payload.fileCount,
                  sizeBytes: payload.sizeBytes,
                });
              } else {
                unsub();
                reject(new Error(payload.message));
              }
            }
          );
          unsubRef.current = unsub;
        }
      );
    };

    (async () => {
      // Pre-pass: total file estimate stays flexible; we rely on per-folder totals.
      for (const folder of folders) {
        if (cancelled) break;
        try {
          const partial = await runOne(folder);
          if (!partial) break;
          cumulativeFiles += partial.fileCount;
          cumulativeBytes += partial.sizeBytes;
          cumulativeProcessed += partial.fileCount;
          cumulativeTotal += partial.fileCount;
          setAccFiles(cumulativeFiles);
          setAccBytes(cumulativeBytes);

          // Persist this folder via addRomFolder (single source of truth).
          await window.electron.addRomFolder(
            system,
            folder.path,
            folder.scanSubfolders
          );
        } catch {
          // continue with next folder
        }
      }

      if (!cancelled) {
        onComplete({ fileCount: cumulativeFiles, sizeBytes: cumulativeBytes });
      }
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      if (requestIdRef.current) {
        window.electron.cancelRomScan(requestIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_scan_title", { system: systemLabel })}
      </h3>
      <p className="setup-modal__body-intro">{t("setup_scan_intro")}</p>

      <div className="setup-modal__progress-meta">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <SyncIcon size={14} />
          <span>{t("setup_scanning")}</span>
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
        <p className="setup-modal__current-file">{currentFile}</p>
      )}

      <div className="setup-modal__stats">
        <div className="setup-modal__stat">
          <span className="setup-modal__stat-label">{t("stat_games")}</span>
          <span className="setup-modal__stat-value">{accFiles}</span>
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
