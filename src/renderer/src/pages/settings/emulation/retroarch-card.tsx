import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, GearIcon, AlertIcon } from "@primer/octicons-react";

import type { RetroArchConfig } from "@types";

import { RETROARCH_EMULATOR_ICON } from "./emulator-icons";
import { RETROARCH_LABEL } from "./retroarch-meta";
import { formatRelativeShort } from "./relative-time";

import "./console-card.scss";

interface RetroArchCardProps {
  config: RetroArchConfig;
  onConfigure: () => void;
  onStartSetup: () => void;
}

export function RetroArchCard({
  config,
  onConfigure,
  onStartSetup,
}: Readonly<RetroArchCardProps>) {
  const { t, i18n } = useTranslation("settings");

  const [executableExists, setExecutableExists] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!config.executablePath) {
      setExecutableExists(false);
      return;
    }
    window.electron
      .checkRetroArchExecutable()
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config.executablePath]);

  const isConfigured = config.executablePath !== null;
  const pathMissing = isConfigured && !executableExists;
  const hasRomFolders = config.romFolders.length > 0;
  const hasRoms = hasRomFolders && config.totalFiles > 0;
  const isReady = isConfigured && executableExists && hasRomFolders;
  const relative =
    config.lastScanAt !== null
      ? formatRelativeShort(config.lastScanAt, i18n.language)
      : null;

  return (
    <div
      className={`console-card ${isConfigured ? "" : "console-card--unconfigured"}`}
    >
      <img
        src={RETROARCH_EMULATOR_ICON}
        alt=""
        className="console-card__art"
        aria-hidden="true"
      />

      <div className="console-card__heading">
        <h3 className="console-card__title">{t("retroarch_card_title")}</h3>
        <div className="console-card__subline">
          <span className="console-card__emulator">{RETROARCH_LABEL}</span>
          {config.detectedVersion && (
            <>
              <span className="console-card__dot" />
              <span
                className="console-card__version"
                title={`v${config.detectedVersion}`}
              >
                v{config.detectedVersion}
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
              <span className="console-card__stat-number">
                {config.totalFiles}
              </span>
              <span className="console-card__stat-label">
                {t("games_found_other", { count: config.totalFiles })
                  .replace(`${config.totalFiles}`, "")
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
              {t("no_rom_folder_hint", { system: RETROARCH_LABEL })}
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
              {t("executable_missing_hint", { name: RETROARCH_LABEL })}
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
              {t("setup_required_hint", { system: RETROARCH_LABEL })}
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
