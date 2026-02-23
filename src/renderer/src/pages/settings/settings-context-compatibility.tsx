import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, ProtonPathPicker } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { ProtonVersion } from "@types";
import { DesktopDownloadIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";

import "./settings-behavior.scss";
import "./settings-general.scss";

export function SettingsContextCompatibility() {
  const { t } = useTranslation("settings");
  const { t: tGameDetails } = useTranslation("game_details");
  const { updateUserPreferences } = useContext(settingsContext);
  const shouldShowCommonRedist = window.electron.platform === "win32";

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [protonVersionsLoaded, setProtonVersionsLoaded] = useState(false);
  const [selectedDefaultProtonPath, setSelectedDefaultProtonPath] =
    useState("");

  const [enableAutoInstall, setEnableAutoInstall] = useState(false);

  useEffect(() => {
    if (!shouldShowCommonRedist) return;

    window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const interval = setInterval(() => {
      window.electron.canInstallCommonRedist().then((canInstall) => {
        setCanInstallCommonRedist(canInstall);
      });
    }, 1000 * 5);

    return () => {
      clearInterval(interval);
    };
  }, [shouldShowCommonRedist]);

  useEffect(() => {
    if (!shouldShowCommonRedist) return;

    const unlisten = window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);
        }
      }
    );

    return () => unlisten();
  }, [shouldShowCommonRedist]);

  useEffect(() => {
    if (!userPreferences) return;

    setEnableAutoInstall(userPreferences.enableAutoInstall ?? false);
    setSelectedDefaultProtonPath(userPreferences.defaultProtonPath ?? "");
  }, [userPreferences]);

  useEffect(() => {
    if (window.electron.platform !== "linux") return;

    window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]))
      .finally(() => setProtonVersionsLoaded(true));
  }, []);

  useEffect(() => {
    if (!protonVersionsLoaded || !selectedDefaultProtonPath) return;

    const hasSelectedVersion = protonVersions.some(
      (version) => version.path === selectedDefaultProtonPath
    );

    if (!hasSelectedVersion) {
      setSelectedDefaultProtonPath("");
    }
  }, [protonVersions, protonVersionsLoaded, selectedDefaultProtonPath]);

  const handleInstallCommonRedist = async () => {
    setInstallingCommonRedist(true);
    try {
      await window.electron.installCommonRedist();
    } catch (err) {
      logger.error(err);
      setInstallingCommonRedist(false);
    }
  };

  return (
    <div className="settings-context-panel">
      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <h3>Proton services</h3>

          <CheckboxField
            label={t("enable_auto_install")}
            checked={enableAutoInstall}
            onChange={() =>
              setEnableAutoInstall((prev) => {
                const nextValue = !prev;
                updateUserPreferences({ enableAutoInstall: nextValue });
                return nextValue;
              })
            }
          />

          <div className="settings-behavior__proton-section">
            <p className="settings-behavior__proton-description">
              {t("default_proton_version_description")}
            </p>

            <ProtonPathPicker
              versions={protonVersions}
              selectedPath={selectedDefaultProtonPath}
              onChange={(value) => {
                setSelectedDefaultProtonPath(value);
                updateUserPreferences({ defaultProtonPath: value || null });
              }}
              radioName="default-proton-version"
              autoLabel={tGameDetails("proton_version_auto")}
              autoSourceDescription={tGameDetails("proton_source_umu_default")}
              steamSourceDescription={tGameDetails("proton_source_steam")}
              compatibilityToolsSourceDescription={tGameDetails(
                "proton_source_compatibility_tools"
              )}
            />
          </div>
        </div>
      )}

      {shouldShowCommonRedist && (
        <div className="settings-context-panel__group">
          <h3>{t("common_redist")}</h3>

          <p className="settings-general__common-redist-description">
            {t("common_redist_description")}
          </p>

          <Button
            onClick={handleInstallCommonRedist}
            className="settings-general__common-redist-button"
            disabled={!canInstallCommonRedist || installingCommonRedist}
          >
            <DesktopDownloadIcon />
            {installingCommonRedist
              ? t("installing_common_redist")
              : t("install_common_redist")}
          </Button>
        </div>
      )}
    </div>
  );
}
