import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { Gamepad2 } from "lucide-react";

import { ClassicsSpinner } from "@renderer/components";

type Phase = "scanning" | "matching" | "done";

interface Props {
  systemLabel: string;
  phase: Phase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
  unmatchedFiles: { name: string; reason: "wrong_platform" | "unmatched" }[];
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
  systemLabel,
  phase,
  processed,
  total,
  percent,
  currentFile,
  status,
  discovered,
  matched,
  sizeBytes,
  unmatchedFiles,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");

  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

  const isDone = phase === "done";
  const indeterminate = !isDone && total === 0;

  const phaseLabel = isDone
    ? t("setup_scan_complete")
    : phase === "scanning"
      ? t("setup_scanning")
      : t("setup_matching");

  const gamesValue = isDone || matched > 0 ? matched : discovered;

  const reasonLabel = (reason: "wrong_platform" | "unmatched") =>
    reason === "wrong_platform"
      ? t("setup_match_wrong_platform")
      : t("setup_match_unmatched");

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_scan_title", { system: systemLabel })}
      </h3>
      <p className="setup-modal__body-intro">{t("setup_scan_intro")}</p>

      <div className="setup-modal__progress-meta">
        <span className="setup-modal__progress-status">
          {isDone ? (
            <CheckCircleFillIcon
              size={14}
              className="setup-modal__progress-check"
            />
          ) : (
            <ClassicsSpinner size={14} />
          )}
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
          {status && (
            <span
              className={`setup-modal__scan-file-status setup-modal__scan-file-status--${status}`}
            >
              {`→ ${
                status === "matched"
                  ? t("setup_match_matched")
                  : reasonLabel(status)
              }`}
            </span>
          )}
        </div>
      )}

      <div className="setup-modal__stats">
        <div className="setup-modal__stat">
          <div className="setup-modal__stat-head">
            <Gamepad2 size={16} className="setup-modal__stat-icon" />
            <span className="setup-modal__stat-label">{t("stat_games")}</span>
          </div>
          <span className="setup-modal__stat-value">{gamesValue}</span>
        </div>
        <div className="setup-modal__stat">
          <div className="setup-modal__stat-head">
            <DatabaseIcon size={16} className="setup-modal__stat-icon" />
            <span className="setup-modal__stat-label">{t("stat_storage")}</span>
          </div>
          <span className="setup-modal__stat-value">
            {formatBytes(sizeBytes)}
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
                  key={`${file.name}-${index}`}
                  className="setup-modal__unmatched-item"
                >
                  <FileDirectoryIcon
                    size={14}
                    className="setup-modal__unmatched-icon"
                  />
                  <span className="setup-modal__unmatched-name">
                    {file.name}
                  </span>
                  <span
                    className={`setup-modal__unmatched-reason setup-modal__unmatched-reason--${file.reason}`}
                  >
                    {reasonLabel(file.reason)}
                  </span>
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
