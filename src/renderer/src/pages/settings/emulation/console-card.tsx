import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, GearIcon, AlertIcon } from "@primer/octicons-react";

import { formatRelativeShort } from "./relative-time";

import "./console-card.scss";

interface ConsoleCardProps {
  art: string;
  title: string;
  emulatorName: string;
  detectedVersion: string | null;
  executablePath: string | null;
  romFoldersCount: number;
  totalFiles: number;
  lastScanAt: number | null;
  checkExecutable: () => Promise<{ exists: boolean }>;
  onConfigure: () => void;
  onStartSetup: () => void;
}

export function ConsoleCard({
  art,
  title,
  emulatorName,
  detectedVersion,
  executablePath,
  romFoldersCount,
  totalFiles,
  lastScanAt,
  checkExecutable,
  onConfigure,
  onStartSetup,
}: Readonly<ConsoleCardProps>) {
  const { t, i18n } = useTranslation("settings");

  const [executableExists, setExecutableExists] = useState(true);

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

  const isConfigured = executablePath !== null;
  const pathMissing = isConfigured && !executableExists;
  const hasRomFolders = romFoldersCount > 0;
  const hasRoms = hasRomFolders && totalFiles > 0;
  const isReady = isConfigured && executableExists && hasRomFolders;
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
          <span className="console-card__emulator">{emulatorName}</span>
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
        {isConfigured && executableExists && hasRoms && (
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
            {relative && (
              <p className="console-card__last-scan">
                {t("last_scan_relative", { value: relative })}
              </p>
            )}
          </div>
        )}

        {isConfigured && executableExists && !hasRoms && (
          <div className="console-card__hint-box">
            <div className="console-card__hint-title">
              <AlertIcon size={14} />
              <span>{t("not_detected")}</span>
            </div>
            <p className="console-card__hint-text">
              {t("no_rom_folder_hint", { system: title })}
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
            <span>{t("configure_emulator")}</span>
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
    </div>
  );
}
