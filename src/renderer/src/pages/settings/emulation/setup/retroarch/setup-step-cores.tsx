import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  DownloadIcon,
  SyncIcon,
  AlertIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import type {
  RetroArchConfig,
  RetroArchCoreInstallProgress,
  RetroArchCoreName,
} from "@types";

import { RETROARCH_CORE_LIST } from "../../retroarch-meta";
import { installPercent } from "../install-progress";

interface Props {
  config: RetroArchConfig;
  onConfigChange: (config: RetroArchConfig) => void;
}

export function SetupStepCores({ config, onConfigChange }: Readonly<Props>) {
  const { t } = useTranslation("settings");

  const [progress, setProgress] = useState<
    Partial<Record<RetroArchCoreName, RetroArchCoreInstallProgress>>
  >({});
  const [installingAll, setInstallingAll] = useState(false);
  const [installingCore, setInstallingCore] =
    useState<RetroArchCoreName | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron.onRetroArchCoreInstallProgress(
      (payload) => {
        setProgress((prev) => ({ ...prev, [payload.core]: payload }));
      }
    );
    return unsubscribe;
  }, []);

  const refreshConfig = useCallback(async () => {
    const next = await window.electron.getRetroArchConfig();
    onConfigChange(next);
  }, [onConfigChange]);

  const handleInstallCore = useCallback(
    async (core: RetroArchCoreName) => {
      if (installingAll || installingCore) return;
      setInstallingCore(core);
      try {
        await window.electron.installRetroArchCore(core);
        await refreshConfig();
      } finally {
        setInstallingCore(null);
      }
    },
    [installingAll, installingCore, refreshConfig]
  );

  const handleInstallAll = useCallback(async () => {
    if (installingAll || installingCore) return;
    setInstallingAll(true);
    try {
      await window.electron.installAllRetroArchCores();
      await refreshConfig();
    } finally {
      setInstallingAll(false);
    }
  }, [installingAll, installingCore, refreshConfig]);

  const allInstalled = useMemo(
    () =>
      RETROARCH_CORE_LIST.every(
        (core) => config.cores[core.name]?.installed === true
      ),
    [config.cores]
  );

  const coreStatusText = (core: RetroArchCoreName): string => {
    const current = progress[core];
    if (current && current.phase === "downloading") {
      return t("setup_install_downloading", {
        percent: installPercent(current.loaded, current.total),
      });
    }
    if (current && current.phase === "extracting") {
      return t("setup_install_extracting");
    }
    if (current && current.phase === "error") {
      return t("setup_install_failed");
    }
    const installed = config.cores[core];
    if (installed?.installed) {
      return installed.installedAt
        ? t("retroarch_core_installed_at", {
            date: new Date(installed.installedAt).toLocaleDateString(),
          })
        : t("retroarch_core_installed");
    }
    return t("retroarch_core_not_installed");
  };

  const coreIcon = (core: RetroArchCoreName) => {
    const current = progress[core];
    const busy =
      current &&
      (current.phase === "downloading" || current.phase === "extracting");
    if (busy) return <SyncIcon size={18} className="setup-modal__spin" />;
    if (current?.phase === "error") return <AlertIcon size={18} />;
    if (config.cores[core]?.installed) return <CheckCircleFillIcon size={20} />;
    return <DownloadIcon size={18} />;
  };

  const busy = installingAll || installingCore !== null;

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("retroarch_setup_cores_title")}
      </h3>
      <p className="setup-modal__body-intro">
        {t("retroarch_setup_cores_intro")}
      </p>

      <div className="setup-modal__folder-list">
        {RETROARCH_CORE_LIST.map((core) => {
          const installed = config.cores[core.name]?.installed === true;
          return (
            <div key={core.name} className="setup-modal__row-card">
              <div
                className={`setup-modal__row-icon ${
                  installed
                    ? "setup-modal__row-icon--found"
                    : "setup-modal__row-icon--warn"
                }`}
              >
                {coreIcon(core.name)}
              </div>
              <div className="setup-modal__row-text">
                <div className="setup-modal__row-heading">
                  <span className="setup-modal__row-title">{core.label}</span>
                  <span className="setup-modal__row-version">
                    {core.platforms}
                  </span>
                </div>
                <span className="setup-modal__row-path">
                  {coreStatusText(core.name)}
                </span>
              </div>
              <Button
                theme="outline"
                onClick={() => handleInstallCore(core.name)}
                disabled={busy}
              >
                {installed
                  ? t("retroarch_core_update")
                  : t("retroarch_core_download")}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="setup-modal__hint">
        {allInstalled ? (
          <div className="setup-modal__hint-group">
            <CheckCircleFillIcon size={14} />
            <span>{t("retroarch_cores_ready")}</span>
          </div>
        ) : (
          <Button theme="primary" onClick={handleInstallAll} disabled={busy}>
            {installingAll
              ? t("retroarch_downloading_cores")
              : t("retroarch_download_all_cores")}
          </Button>
        )}
      </div>
    </>
  );
}
