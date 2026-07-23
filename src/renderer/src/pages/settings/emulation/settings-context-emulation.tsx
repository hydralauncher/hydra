import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import type {
  EmulatorConfigMap,
  EmulatorSystem,
  RetroArchConfig,
} from "@types";

import { ConsoleCard } from "./console-card";
import { EmulatorDetail } from "./emulator-detail";
import { EmulatorSetupModal } from "./setup/emulator-setup-modal";
import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import { RETROARCH_EMULATOR_ICON } from "./emulator-icons";
import { RETROARCH_LABEL } from "./retroarch-meta";
import { RetroArchDetail } from "./retroarch-detail";
import { RetroArchSetupModal } from "./setup/retroarch/retroarch-setup-modal";
import ps1Art from "@renderer/assets/emulation/ps1.png";
import ps2Art from "@renderer/assets/emulation/ps2.png";
import ps3Art from "@renderer/assets/emulation/ps3.png";
import {
  ClassicsOnboardingModal,
  hasDismissedClassicsOnboarding,
} from "@renderer/components/classics-onboarding-modal/classics-onboarding-modal";

import "./settings-context-emulation.scss";

const SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

const SYSTEM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation 1",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
};

const SYSTEM_ART: Record<EmulatorSystem, string> = {
  ps1: ps1Art,
  ps2: ps2Art,
  ps3: ps3Art,
};

export function SettingsContextEmulation() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [retroArchConfig, setRetroArchConfig] =
    useState<RetroArchConfig | null>(null);
  const [view, setView] = useState<
    | { kind: "grid" }
    | { kind: "detail"; system: EmulatorSystem }
    | { kind: "retroarch-detail" }
  >({ kind: "grid" });
  const [setupSystem, setSetupSystem] = useState<EmulatorSystem | null>(null);
  const [retroArchSetupOpen, setRetroArchSetupOpen] = useState(false);
  const deepLinkAppliedRef = useRef(false);

  const [showClassicsOnboarding, setShowClassicsOnboarding] = useState(false);
  const classicsOnboardingTriggeredRef = useRef(false);

  useEffect(() => {
    if (
      !classicsOnboardingTriggeredRef.current &&
      !hasDismissedClassicsOnboarding()
    ) {
      classicsOnboardingTriggeredRef.current = true;
      setShowClassicsOnboarding(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await window.electron.getEmulatorConfigs();
    setConfigs(next);
    return next;
  }, []);

  const refreshRetroArch = useCallback(async () => {
    const next = await window.electron.getRetroArchConfig();
    setRetroArchConfig(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initial = await window.electron.getEmulatorConfigs();
      if (cancelled) return;

      const anyDetected = SYSTEMS.some((s) => initial[s].detectedAt !== null);
      if (!anyDetected) {
        const detected = await window.electron.detectEmulators();
        if (cancelled) return;
        setConfigs(detected);
        return;
      }

      setConfigs(initial);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initial = await window.electron.getRetroArchConfig();
      if (cancelled) return;

      if (initial.detectedAt === null) {
        const detected = await window.electron.detectRetroArch();
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
    if (deepLinkAppliedRef.current || !configs || !retroArchConfig) return;
    const system = searchParams.get("system");
    if (system === "retroarch") {
      deepLinkAppliedRef.current = true;
      if (retroArchConfig.executablePath) {
        setView({ kind: "retroarch-detail" });
      }
      return;
    }
    if (system && SYSTEMS.includes(system as EmulatorSystem)) {
      deepLinkAppliedRef.current = true;
      if (configs[system as EmulatorSystem].executablePath) {
        setView({ kind: "detail", system: system as EmulatorSystem });
      }
    }
  }, [configs, retroArchConfig, searchParams]);

  const handleConfigure = useCallback((system: EmulatorSystem) => {
    setView({ kind: "detail", system });
  }, []);

  const handleStartSetup = useCallback((system: EmulatorSystem) => {
    setSetupSystem(system);
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetupSystem(null);
    localStorage.setItem("library-category", "classics");
    navigate("/library");
  }, [navigate]);

  const handleSetupClose = useCallback(async () => {
    setSetupSystem(null);
    await refresh();
  }, [refresh]);

  const handleRetroArchSetupComplete = useCallback(() => {
    setRetroArchSetupOpen(false);
    localStorage.setItem("library-category", "classics");
    navigate("/library");
  }, [navigate]);

  const handleRetroArchSetupClose = useCallback(async () => {
    setRetroArchSetupOpen(false);
    await refreshRetroArch();
  }, [refreshRetroArch]);

  const handleBack = useCallback(() => {
    setView({ kind: "grid" });
  }, []);

  const detailConfig = useMemo(() => {
    if (view.kind !== "detail" || !configs) return null;
    return configs[view.system];
  }, [configs, view]);

  if (!configs || !retroArchConfig) {
    return <div className="settings-emulation__loading">…</div>;
  }

  if (view.kind === "detail" && detailConfig) {
    return (
      <EmulatorDetail
        config={detailConfig}
        systemLabel={SYSTEM_LABELS[view.system]}
        onBack={handleBack}
        onChange={(next) =>
          setConfigs((prev) => (prev ? { ...prev, [next.system]: next } : prev))
        }
        refresh={refresh}
      />
    );
  }

  if (view.kind === "retroarch-detail") {
    return (
      <RetroArchDetail
        config={retroArchConfig}
        onBack={handleBack}
        onChange={setRetroArchConfig}
        refresh={refreshRetroArch}
      />
    );
  }

  return (
    <div className="settings-emulation">
      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />
      <header className="settings-emulation__header">
        <h2 className="settings-emulation__title">{t("emulation")}</h2>
        <p className="settings-emulation__description">
          {t("emulation_description")}
        </p>
        <p className="settings-emulation__disclaimer">
          {t("emulation_disclaimer")}
        </p>
      </header>

      <div className="settings-emulation__cards">
        {SYSTEMS.map((system) => (
          <ConsoleCard
            key={system}
            art={SYSTEM_ART[system]}
            title={SYSTEM_LABELS[system]}
            emulatorName={KNOWN_BINARY_LABELS[configs[system].binary]}
            detectedVersion={configs[system].detectedVersion}
            executablePath={configs[system].executablePath}
            romFoldersCount={configs[system].romFolders.length}
            totalFiles={configs[system].totalFiles}
            lastScanAt={configs[system].lastScanAt}
            checkExecutable={() =>
              window.electron.checkEmulatorExecutable(system)
            }
            onConfigure={() => handleConfigure(system)}
            onStartSetup={() => handleStartSetup(system)}
          />
        ))}
        <ConsoleCard
          art={RETROARCH_EMULATOR_ICON}
          title={t("retroarch_card_title")}
          emulatorName={RETROARCH_LABEL}
          detectedVersion={retroArchConfig.detectedVersion}
          executablePath={retroArchConfig.executablePath}
          romFoldersCount={retroArchConfig.romFolders.length}
          totalFiles={retroArchConfig.totalFiles}
          lastScanAt={retroArchConfig.lastScanAt}
          checkExecutable={() => window.electron.checkRetroArchExecutable()}
          onConfigure={() => setView({ kind: "retroarch-detail" })}
          onStartSetup={() => setRetroArchSetupOpen(true)}
        />
      </div>

      <EmulatorSetupModal
        visible={setupSystem !== null}
        system={setupSystem}
        systemLabel={setupSystem ? SYSTEM_LABELS[setupSystem] : ""}
        initialConfig={setupSystem ? configs[setupSystem] : null}
        onClose={handleSetupClose}
        onComplete={handleSetupComplete}
      />

      <RetroArchSetupModal
        visible={retroArchSetupOpen}
        initialConfig={retroArchConfig}
        onClose={handleRetroArchSetupClose}
        onComplete={handleRetroArchSetupComplete}
      />
    </div>
  );
}
