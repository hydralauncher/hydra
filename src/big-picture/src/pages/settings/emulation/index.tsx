import "./styles.scss";

import { AlertIcon, ChevronRightIcon, GearIcon } from "@primer/octicons-react";
import type {
  EmulatorConfigMap,
  EmulatorSystem,
  RetroArchConfig,
} from "@types";
import cn from "classnames";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RETROARCH_EMULATOR_ICON } from "@renderer/pages/settings/emulation/emulator-icons";
import {
  RETROARCH_LABEL,
  RETROARCH_CORES_TAGLINE,
} from "@renderer/pages/settings/emulation/retroarch-meta";
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
import { RetroArchEmulationDetail } from "./retroarch-detail";
import { SettingsSection } from "../settings-section";

interface SettingsSectionProps {
  className?: string;
}

type EmulationView =
  | { kind: "grid" }
  | { kind: "detail"; system: EmulatorSystem }
  | { kind: "retroarch" };

type EmulationCardKey = EmulatorSystem | "retroarch";

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
  focusId: string;
  navigationOverrides?: FocusOverrides;
  onOpen: () => void;
}

function ConsoleCard({
  art,
  title,
  emulatorName,
  detectedVersion,
  executablePath,
  romFoldersCount,
  totalFiles,
  lastScanAt,
  checkExecutable,
  focusId,
  navigationOverrides,
  onOpen,
}: Readonly<ConsoleCardProps>) {
  const { t } = useTranslation("settings");
  const [executableExists, setExecutableExists] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!executablePath) {
      setExecutableExists(false);
      return undefined;
    }

    void checkExecutable()
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
  const relative = formatRelative(lastScanAt);

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
          src={art}
          alt=""
          className="console-card__art"
          aria-hidden="true"
        />

        <div className="console-card__heading">
          <h3 className="console-card__title">{title}</h3>
          <div className="console-card__subline">
            <span className="console-card__emulator">{emulatorName}</span>
            {detectedVersion ? (
              <>
                <span className="console-card__dot" />
                <span
                  className="console-card__version"
                  title={`v${detectedVersion}`}
                >
                  v{detectedVersion}
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
                <span className="console-card__stat-number">{totalFiles}</span>
                <span className="console-card__stat-label">
                  {t("games_found_other", { count: totalFiles })
                    .replace(`${totalFiles}`, "")
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
                {t("no_rom_folder_hint", { system: title })}
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
                {t("executable_missing_hint", { name: emulatorName })}
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
                {t("setup_required_hint", { system: title })}
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
  const [retroArchConfig, setRetroArchConfig] =
    useState<RetroArchConfig | null>(null);
  const [view, setView] = useState<EmulationView>({ kind: "grid" });
  const [returnSystem, setReturnSystem] = useState<EmulationCardKey>("ps1");

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
    let cancelled = false;

    void (async () => {
      const initial = await globalThis.window.electron.getRetroArchConfig();
      if (cancelled) return;

      if (initial.detectedAt === null) {
        const detected = await globalThis.window.electron.detectRetroArch();
        if (cancelled) return;
        setRetroArchConfig(detected);
        return;
      }

      setRetroArchConfig(initial);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const frameId = globalThis.window.requestAnimationFrame(() => {
      if (view.kind === "detail" || view.kind === "retroarch") {
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
    Record<EmulationCardKey, FocusOverrides>
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
        right: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.retroarch),
      },
      retroarch: {
        left: getItemFocusTarget(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps3),
        right: { type: "block" },
      },
    }),
    []
  );

  if (!configs || !retroArchConfig) {
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

  if (view.kind === "retroarch") {
    return (
      <RetroArchEmulationDetail
        config={retroArchConfig}
        onBack={() => {
          setReturnSystem("retroarch");
          setView({ kind: "grid" });
        }}
        onChange={setRetroArchConfig}
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
              art={EMULATION_SYSTEM_ART[system]}
              title={EMULATION_SYSTEM_LABELS[system]}
              emulatorName={KNOWN_BINARY_LABELS[configs[system].binary]}
              detectedVersion={configs[system].detectedVersion}
              executablePath={configs[system].executablePath}
              romFoldersCount={configs[system].romFolders.length}
              totalFiles={configs[system].totalFiles}
              lastScanAt={configs[system].lastScanAt}
              checkExecutable={() =>
                globalThis.window.electron.checkEmulatorExecutable(system)
              }
              navigationOverrides={cardNavigationOverridesBySystem[system]}
              onOpen={() => setView({ kind: "detail", system })}
            />
          ))}
          <ConsoleCard
            focusId={EMULATION_OVERVIEW_CARD_FOCUS_IDS.retroarch}
            art={RETROARCH_EMULATOR_ICON}
            title={RETROARCH_LABEL}
            emulatorName={RETROARCH_CORES_TAGLINE}
            detectedVersion={retroArchConfig.detectedVersion}
            executablePath={retroArchConfig.executablePath}
            romFoldersCount={retroArchConfig.romFolders.length}
            totalFiles={retroArchConfig.totalFiles}
            lastScanAt={retroArchConfig.lastScanAt}
            checkExecutable={() =>
              globalThis.window.electron.checkRetroArchExecutable()
            }
            navigationOverrides={cardNavigationOverridesBySystem.retroarch}
            onOpen={() => setView({ kind: "retroarch" })}
          />
        </GridFocusGroup>
      </SettingsSection>
    </div>
  );
}

export { EMULATION_OVERVIEW_CARD_FOCUS_IDS };
