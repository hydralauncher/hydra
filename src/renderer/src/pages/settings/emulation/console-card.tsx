import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, GearIcon, AlertIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import { formatRelativeShort } from "./relative-time";

import "./console-card.scss";

export type ConsoleCardRequirement = "bios" | "firmware" | "cores";

interface ConsoleCardProps {
  art: string;
  title: string;
  emulatorName: string;
  emulatorNameTooltip?: string;
  detectedVersion: string | null;
  executablePath: string | null;
  romFoldersCount: number;
  totalFiles: number;
  lastScanAt: number | null;
  requirement?: ConsoleCardRequirement;
  checkExecutable: () => Promise<{ exists: boolean }>;
  checkRequirement?: () => Promise<boolean>;
  requirementKey?: unknown;
  onConfigure: () => void;
  onStartSetup: () => void;
}

export function ConsoleCard({
  art,
  title,
  emulatorName,
  emulatorNameTooltip,
  detectedVersion,
  executablePath,
  romFoldersCount,
  totalFiles,
  lastScanAt,
  requirement,
  checkExecutable,
  checkRequirement,
  requirementKey,
  onConfigure,
  onStartSetup,
}: Readonly<ConsoleCardProps>) {
  const { t, i18n } = useTranslation("settings");
  const tooltipId = useId();

  const [executableExists, setExecutableExists] = useState(true);
  const [requirementMet, setRequirementMet] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!executablePath) {
      setExecutableExists(false);
      return;
    }
    checkExecutable()
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executablePath]);

  useEffect(() => {
    let cancelled = false;

    if (!requirement || !checkRequirement || !executablePath) {
      setRequirementMet(true);
      return;
    }

    checkRequirement()
      .then((satisfied) => {
        if (!cancelled) setRequirementMet(satisfied);
      })
      .catch(() => {
        if (!cancelled) setRequirementMet(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executablePath, requirement, requirementKey]);

  const isConfigured = executablePath !== null;
  const pathMissing = isConfigured && !executableExists;
  const hasRomFolders = romFoldersCount > 0;
  const requirementMissing = Boolean(requirement) && !requirementMet;
  const isReady = isConfigured && executableExists && !requirementMissing;
  const relative =
    lastScanAt !== null ? formatRelativeShort(lastScanAt, i18n.language) : null;

  return (
    <div
      className={`console-card ${isConfigured ? "" : "console-card--unconfigured"}`}
    >
      <img src={art} alt="" className="console-card__art" aria-hidden="true" />

      <div className="console-card__heading">
        <h3 className="console-card__title">{title}</h3>
        <div className="console-card__subline">
          <span
            className="console-card__emulator"
            data-tooltip-id={emulatorNameTooltip ? tooltipId : undefined}
            data-tooltip-content={emulatorNameTooltip}
            data-tooltip-place="bottom"
          >
            {emulatorName}
          </span>
          {detectedVersion && (
            <>
              <span className="console-card__dot" />
              <span
                className="console-card__version"
                title={`v${detectedVersion}`}
              >
                v{detectedVersion}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="console-card__body">
        {isConfigured && executableExists && !requirementMissing && (
          <div className="console-card__stats">
            <div className="console-card__stat-row">
              <span className="console-card__stat-dot" />
              <span className="console-card__stat-number">{totalFiles}</span>
              <span className="console-card__stat-label">
                {t("games_found_other", { count: totalFiles })
                  .replace(`${totalFiles}`, "")
                  .trim()}
              </span>
            </div>
            {hasRomFolders && relative ? (
              <p className="console-card__last-scan">
                {t("last_scan_relative", { value: relative })}
              </p>
            ) : (
              <p className="console-card__last-scan">
                {t("no_rom_folder_hint", { system: title })}
              </p>
            )}
          </div>
        )}

        {isConfigured && executableExists && requirementMissing && (
          <div className="console-card__hint-box">
            <div className="console-card__hint-title">
              <AlertIcon size={14} />
              <span>{t(`${requirement}_missing`)}</span>
            </div>
            <p className="console-card__hint-text">
              {t(`${requirement}_missing_hint`, { name: emulatorName })}
            </p>
          </div>
        )}

        {pathMissing && (
          <div className="console-card__hint-box">
            <div className="console-card__hint-title">
              <AlertIcon size={14} />
              <span>{t("executable_missing")}</span>
            </div>
            <p className="console-card__hint-text">
              {t("executable_missing_hint", { name: emulatorName })}
            </p>
          </div>
        )}

        {!isConfigured && (
          <div className="console-card__hint-box">
            <div className="console-card__hint-title">
              <AlertIcon size={14} />
              <span>{t("setup_required")}</span>
            </div>
            <p className="console-card__hint-text">
              {t("setup_required_hint", { system: title })}
            </p>
          </div>
        )}
      </div>

      <div className="console-card__divider" />

      <div className="console-card__footer">
        {isReady ? (
          <span className="console-card__chip console-card__chip--ready">
            <span className="console-card__chip-dot" />
            {t("ready_to_play")}
          </span>
        ) : (
          <span className="console-card__chip console-card__chip--warn">
            <span className="console-card__chip-dot" />
            {t("setup_needed")}
          </span>
        )}

        {isConfigured ? (
          <button
            type="button"
            className="console-card__cta"
            onClick={onConfigure}
          >
            <GearIcon size={14} />
            <span>{t(isReady ? "manage_emulator" : "configure_emulator")}</span>
            <ChevronRightIcon size={12} />
          </button>
        ) : (
          <button
            type="button"
            className="console-card__cta"
            onClick={onStartSetup}
          >
            <GearIcon size={14} />
            <span>{t("start_setup")}</span>
            <ChevronRightIcon size={12} />
          </button>
        )}
      </div>

      {emulatorNameTooltip && (
        <Tooltip id={tooltipId} style={{ zIndex: 9999 }} openOnClick={false} />
      )}
    </div>
  );
}
