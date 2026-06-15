import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { EmulatorConfigMap, EmulatorSystem } from "@types";

import { ConsoleCard } from "./console-card";
import { EmulatorDetail } from "./emulator-detail";
import { EmulatorSetupModal } from "./setup/emulator-setup-modal";
import { TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
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

export function SettingsContextEmulation() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [retroachievementsApiKey, setRetroachievementsApiKey] = useState("");
  const [retroachievementsUsername, setRetroachievementsUsername] =
    useState("");
  const [view, setView] = useState<
    { kind: "grid" } | { kind: "detail"; system: EmulatorSystem }
  >({ kind: "grid" });
  const [setupSystem, setSetupSystem] = useState<EmulatorSystem | null>(null);
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

  useEffect(() => {
    setRetroachievementsApiKey(userPreferences?.retroachievementsApiKey ?? "");
    setRetroachievementsUsername(
      userPreferences?.retroachievementsUsername ?? ""
    );
  }, [userPreferences]);

  const refresh = useCallback(async () => {
    const next = await window.electron.getEmulatorConfigs();
    setConfigs(next);
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
    if (deepLinkAppliedRef.current || !configs) return;
    const system = searchParams.get("system");
    if (system && SYSTEMS.includes(system as EmulatorSystem)) {
      deepLinkAppliedRef.current = true;
      setView({ kind: "detail", system: system as EmulatorSystem });
    }
  }, [configs, searchParams]);

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

  const handleBack = useCallback(() => {
    setView({ kind: "grid" });
  }, []);

  const detailConfig = useMemo(() => {
    if (view.kind !== "detail" || !configs) return null;
    return configs[view.system];
  }, [configs, view]);

  if (!configs) {
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

  return (
    <div className="settings-emulation">
      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />
      <header className="settings-emulation__header">
        <div className="settings-emulation__title-row">
          <h2 className="settings-emulation__title">{t("emulation")}</h2>
          <span className="settings-emulation__new-badge">
            {t("new_badge")}
          </span>
        </div>
        <p className="settings-emulation__description">
          {t("emulation_description")}
        </p>
        <p className="settings-emulation__disclaimer">
          {t("emulation_disclaimer")}
        </p>
      </header>

      <section className="settings-context-panel__group">
        <h3>RetroAchievements</h3>
        <p className="settings-emulation__description">
          RetroAchievements is a service that adds achievements to classic
          games.
        </p>
        <TextField
          label="RetroAchievements API key"
          value={retroachievementsApiKey}
          type="password"
          onChange={(event) => {
            const value = event.target.value;
            setRetroachievementsApiKey(value);
            updateUserPreferences({
              retroachievementsApiKey: value || null,
            });
          }}
          placeholder="API key"
        />
        <TextField
          label="RetroAchievements username"
          value={retroachievementsUsername}
          onChange={(event) => {
            const value = event.target.value;
            setRetroachievementsUsername(value);
            updateUserPreferences({
              retroachievementsUsername: value || null,
            });
          }}
          placeholder="Username"
        />
      </section>

      <div className="settings-emulation__cards">
        {SYSTEMS.map((system) => (
          <ConsoleCard
            key={system}
            config={configs[system]}
            systemLabel={SYSTEM_LABELS[system]}
            onConfigure={() => handleConfigure(system)}
            onStartSetup={() => handleStartSetup(system)}
          />
        ))}
      </div>

      <EmulatorSetupModal
        visible={setupSystem !== null}
        system={setupSystem}
        systemLabel={setupSystem ? SYSTEM_LABELS[setupSystem] : ""}
        initialConfig={setupSystem ? configs[setupSystem] : null}
        onClose={handleSetupClose}
        onComplete={handleSetupComplete}
      />
    </div>
  );
}
