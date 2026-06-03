import { useTranslation } from "react-i18next";
import { ChevronRightIcon, GearIcon, AlertIcon } from "@primer/octicons-react";

import type { EmulatorConfig } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import ps1Art from "@renderer/assets/emulation/ps1.png";
import ps2Art from "@renderer/assets/emulation/ps2.png";
import ps3Art from "@renderer/assets/emulation/ps3.png";

import "./console-card.scss";

const ART: Record<string, string> = {
  ps1: ps1Art,
  ps2: ps2Art,
  ps3: ps3Art,
};

interface ConsoleCardProps {
  config: EmulatorConfig;
  systemLabel: string;
  onConfigure: () => void;
  onStartSetup: () => void;
}

const formatRelative = (ts: number | null): string | null => {
  if (ts === null) return null;
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export function ConsoleCard({
  config,
  systemLabel,
  onConfigure,
  onStartSetup,
}: Readonly<ConsoleCardProps>) {
  const { t } = useTranslation("settings");

  const binaryName = KNOWN_BINARY_LABELS[config.binary];
  const isConfigured = config.executablePath !== null;
  const hasRomFolders = config.romFolders.length > 0;
  const hasRoms = hasRomFolders && config.totalFiles > 0;
  const isReady = isConfigured && hasRomFolders;
  const relative = formatRelative(config.lastScanAt);

  return (
    <div
      className={`console-card ${isConfigured ? "" : "console-card--unconfigured"}`}
    >
      <img
        src={ART[config.system]}
        alt=""
        className="console-card__art"
        aria-hidden="true"
      />

      <div className="console-card__heading">
        <h3 className="console-card__title">{systemLabel}</h3>
        <div className="console-card__subline">
          <span className="console-card__emulator">{binaryName}</span>
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
        {isConfigured && hasRoms && (
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

        {isConfigured && !hasRoms && (
          <div className="console-card__hint-box">
            <div className="console-card__hint-title">
              <AlertIcon size={14} />
              <span>{t("not_detected")}</span>
            </div>
            <p className="console-card__hint-text">
              {t("no_rom_folder_hint", { system: systemLabel })}
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
              {t("setup_required_hint", { system: systemLabel })}
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
