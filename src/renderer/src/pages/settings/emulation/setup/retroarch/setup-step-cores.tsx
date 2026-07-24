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

import {
  RETROARCH_CORE_LIST,
  retroArchCoreStatusText,
} from "../../retroarch-meta";

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

  const handleInstallAll = useCallback(async () => {
    if (installingAll) return;
    setInstallingAll(true);
    try {
      await window.electron.installAllRetroArchCores();
      await refreshConfig();
    } finally {
      setInstallingAll(false);
    }
  }, [installingAll, refreshConfig]);

  const allInstalled = useMemo(
    () =>
      RETROARCH_CORE_LIST.every(
        (core) => config.cores[core.name]?.installed === true
      ),
    [config.cores]
  );

  const coreIcon = (core: RetroArchCoreName) => {
    const current = progress[core];
    const busy =
      current?.phase === "downloading" || current?.phase === "extracting";
    if (busy) return <SyncIcon size={18} className="setup-modal__spin" />;
    if (current?.phase === "error") return <AlertIcon size={18} />;
    if (config.cores[core]?.installed) return <CheckCircleFillIcon size={20} />;
    return <DownloadIcon size={18} />;
  };

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
                  {retroArchCoreStatusText(t, core.name, config, progress)}
                </span>
              </div>
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
          <Button
            theme="primary"
            onClick={handleInstallAll}
            disabled={installingAll}
          >
            <DownloadIcon size={14} />
            <span>
              {installingAll
                ? t("retroarch_downloading_cores")
                : t("retroarch_download_all_cores")}
            </span>
          </Button>
        )}
      </div>
    </>
  );
}
