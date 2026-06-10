import "./styles.scss";

import { AlertIcon, ChevronRightIcon, GearIcon } from "@primer/octicons-react";
import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";
import cn from "classnames";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getItemFocusTarget } from "../../../helpers";
import type { FocusOverrides } from "../../../services";

import { FocusItem, GridFocusGroup } from "../../../components";
import { useNavigation } from "../../../hooks";
import {
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  EMULATION_OVERVIEW_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
  SETTINGS_SIDEBAR_RETURN_TARGET,
} from "../settings-navigation";
import {
  EMULATION_SYSTEM_ART,
  EMULATION_SYSTEM_LABELS,
  EMULATION_SYSTEMS,
  KNOWN_BINARY_LABELS,
  formatRelative,
} from "./shared";
import { EmulationDetail } from "./detail";
import { SettingsSection } from "../settings-section";

interface SettingsSectionProps {
  className?: string;
}

type EmulationView =
  | { kind: "grid" }
  | { kind: "detail"; system: EmulatorSystem };

interface ConsoleCardProps {
  config: EmulatorConfig;
  systemLabel: string;
  focusId: string;
  navigationOverrides?: FocusOverrides;
  onOpen: () => void;
}

function ConsoleCard({
  config,
  systemLabel,
  focusId,
  navigationOverrides,
  onOpen,
}: Readonly<ConsoleCardProps>) {
  const { t } = useTranslation("settings");
  const [executableExists, setExecutableExists] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!config.executablePath) {
      setExecutableExists(false);
      return undefined;
    }

    void globalThis.window.electron
      .checkEmulatorExecutable(config.system)
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config.executablePath, config.system]);

  const binaryName = KNOWN_BINARY_LABELS[config.binary];
  const isConfigured = config.executablePath !== null;
  const pathMissing = isConfigured && !executableExists;
  const hasRomFolders = config.romFolders.length > 0;
  const hasRoms = hasRomFolders && config.totalFiles > 0;
  const isReady = isConfigured && executableExists && hasRomFolders;
  const relative = formatRelative(config.lastScanAt);

  return (
    <FocusItem id={focusId} navigationOverrides={navigationOverrides} asChild>
      <button
        type="button"
        className={cn("console-card", {
          "console-card--unconfigured": !isConfigured,
        })}
        onClick={onOpen}
      >
        <img
          src={EMULATION_SYSTEM_ART[config.system]}
          alt=""
          className="console-card__art"
          aria-hidden="true"
        />

        <div className="console-card__heading">
          <h3 className="console-card__title">{systemLabel}</h3>
          <div className="console-card__subline">
            <span className="console-card__emulator">{binaryName}</span>
            {config.detectedVersion ? (
              <>
                <span className="console-card__dot" />
                <span
                  className="console-card__version"
                  title={`v${config.detectedVersion}`}
                >
                  v{config.detectedVersion}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="console-card__body">
          {isConfigured && executableExists && hasRoms ? (
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
              <p className="console-card__last-scan">
                {t("last_scan_relative", { value: relative })}
              </p>
            </div>
          ) : null}

          {isConfigured && executableExists && !hasRoms ? (
            <div className="console-card__hint-box">
              <div className="console-card__hint-title">
                <AlertIcon size={14} />
                <span>{t("not_detected")}</span>
              </div>
              <p className="console-card__hint-text">
                {t("no_rom_folder_hint", { system: systemLabel })}
              </p>
            </div>
          ) : null}

          {pathMissing ? (
            <div className="console-card__hint-box">
              <div className="console-card__hint-title">
                <AlertIcon size={14} />
                <span>{t("executable_missing")}</span>
              </div>
              <p className="console-card__hint-text">
                {t("executable_missing_hint", { name: binaryName })}
              </p>
            </div>
          ) : null}

          {!isConfigured ? (
            <div className="console-card__hint-box">
              <div className="console-card__hint-title">
                <AlertIcon size={14} />
                <span>{t("setup_required")}</span>
              </div>
              <p className="console-card__hint-text">
                {t("setup_required_hint", { system: systemLabel })}
              </p>
            </div>
          ) : null}
        </div>

        <div className="console-card__divider" />

        <div className="console-card__footer">
          <span
            className={cn("console-card__chip", {
              "console-card__chip--ready": isReady,
              "console-card__chip--warn": !isReady,
            })}
          >
            <span className="console-card__chip-dot" />
            {isReady ? t("ready_to_play") : t("setup_needed")}
          </span>

          <span className="console-card__cta">
            <GearIcon size={14} />
            <span>
              {isConfigured ? t("configure_emulator") : t("start_setup")}
            </span>
            <ChevronRightIcon size={12} />
          </span>
        </div>
      </button>
    </FocusItem>
  );
}

export function EmulationSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigation();
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [view, setView] = useState<EmulationView>({ kind: "grid" });
  const [returnSystem, setReturnSystem] = useState<EmulatorSystem>("ps1");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const initial = await globalThis.window.electron.getEmulatorConfigs();
      if (cancelled) return;

      const anyDetected = EMULATION_SYSTEMS.some(
        (system) => initial[system].detectedAt !== null
      );

      if (!anyDetected) {
        const detected = await globalThis.window.electron.detectEmulators();
        if (cancelled) return;
        setConfigs(detected);
        return;
      }

      setConfigs(initial);

      const staleSystems = EMULATION_SYSTEMS.filter(
        (system) =>
          initial[system].executablePath !== null &&
          initial[system].detectedVersion === null
      );

      if (staleSystems.length === 0) return;

      const refreshed = { ...initial };
      for (const system of staleSystems) {
        refreshed[system] =
          await globalThis.window.electron.detectEmulator(system);
        if (cancelled) return;
      }

      setConfigs(refreshed);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const frameId = globalThis.window.requestAnimationFrame(() => {
      if (view.kind === "detail") {
        setFocus(EMULATION_DETAIL_BACK_BUTTON_ID);
        return;
      }

      setFocus(EMULATION_OVERVIEW_CARD_FOCUS_IDS[returnSystem]);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [returnSystem, setFocus, view]);

  const detailConfig = useMemo(() => {
    if (!configs || view.kind !== "detail") return null;
    return configs[view.system];
  }, [configs, view]);

  const cardNavigationOverridesBySystem = useMemo<
    Record<EmulatorSystem, FocusOverrides>
  >(
    () => ({
      ps1: {
        left: SETTINGS_SIDEBAR_RETURN_TARGET,
        right: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps2),
      },
      ps2: {
        left: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps1),
        right: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps3),
      },
      ps3: {
        left: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps2),
        right: { type: "block" },
      },
    }),
    []
  );

  if (!configs) {
    return (
      <div className={cn("settings-emulation", className)}>
        <div className="settings-emulation__loading">…</div>
      </div>
    );
  }

  if (view.kind === "detail" && detailConfig) {
    return (
      <EmulationDetail
        config={detailConfig}
        systemLabel={EMULATION_SYSTEM_LABELS[view.system]}
        onBack={() => {
          setReturnSystem(view.system);
          setView({ kind: "grid" });
        }}
        onChange={(nextConfig) =>
          setConfigs((current) =>
            current
              ? {
                  ...current,
                  [nextConfig.system]: nextConfig,
                }
              : current
          )
        }
      />
    );
  }

  return (
    <div className={cn("settings-emulation", className)}>
      <SettingsSection
        title={t("console_cores")}
        description={t("console_cores_description")}
      >
        <GridFocusGroup
          regionId={EMULATION_OVERVIEW_REGION_ID}
          navigationOverrides={{ up: SETTINGS_HEADER_RETURN_TARGET }}
          className="settings-emulation__cards"
        >
          {EMULATION_SYSTEMS.map((system) => (
            <ConsoleCard
              key={system}
              focusId={EMULATION_OVERVIEW_CARD_FOCUS_IDS[system]}
              config={configs[system]}
              systemLabel={EMULATION_SYSTEM_LABELS[system]}
              navigationOverrides={cardNavigationOverridesBySystem[system]}
              onOpen={() => setView({ kind: "detail", system })}
            />
          ))}
        </GridFocusGroup>
      </SettingsSection>
    </div>
  );
}

export { EMULATION_OVERVIEW_CARD_FOCUS_IDS };
