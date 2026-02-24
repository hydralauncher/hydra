import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  ProtonPathPicker,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { ProtonVersion } from "@types";
import { DesktopDownloadIcon, LinkExternalIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import { Tooltip } from "react-tooltip";

import "./settings-behavior.scss";
import "./settings-general.scss";

export function SettingsContextCompatibility() {
  const MANGOHUD_SITE_URL = "https://mangohud.com";
  const GAMEMODE_SITE_URL = "https://github.com/FeralInteractive/gamemode";

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

  const [autoRunMangohud, setAutoRunMangohud] = useState(false);
  const [autoRunGamemode, setAutoRunGamemode] = useState(false);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);

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

    setSelectedDefaultProtonPath(userPreferences.defaultProtonPath ?? "");
    setAutoRunMangohud(userPreferences.autoRunMangohud ?? false);
    setAutoRunGamemode(userPreferences.autoRunGamemode ?? false);
  }, [userPreferences]);

  useEffect(() => {
    if (window.electron.platform !== "linux") {
      setGamemodeAvailable(false);
      setMangohudAvailable(false);
      return;
    }

    window.electron
      .isGamemodeAvailable()
      .then(setGamemodeAvailable)
      .catch(() => setGamemodeAvailable(false));

    window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
  }, []);

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

  const protonVersionAutoLabel = t("proton_version_auto", {
    ns: ["settings", "game_details"],
    defaultValue: "Auto (global default or umu default)",
  });

  const protonSourceUmuDefault = t("proton_source_umu_default", {
    ns: ["settings", "game_details"],
    defaultValue: "umu default selection",
  });

  const protonSourceSteam = t("proton_source_steam", {
    ns: ["settings", "game_details"],
    defaultValue: "Installed by Steam",
  });

  const protonSourceCompatibilityTools = t(
    "proton_source_compatibility_tools",
    {
      ns: ["settings", "game_details"],
      defaultValue: "Installed in Steam compatibilitytools.d",
    }
  );

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
    <div className="settings-context-panel settings-context-compatibility">
      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <div className="settings-context-compatibility__stack">
            <div className="settings-behavior__proton-section settings-context-compatibility__section">
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
                autoLabel={protonVersionAutoLabel}
                autoSourceDescription={protonSourceUmuDefault}
                steamSourceDescription={protonSourceSteam}
                compatibilityToolsSourceDescription={
                  protonSourceCompatibilityTools
                }
              />
            </div>

            <div className="settings-context-compatibility__section settings-context-compatibility__global-toggles">
              <h3 className="settings-behavior__proton-title">
                {t("behavior")}
              </h3>

              <div className="settings-behavior__gamemode-toggle">
                <CheckboxField
                  label={
                    <span
                      className={`settings-behavior__gamemode-label ${
                        !gamemodeAvailable
                          ? "settings-behavior__gamemode-label--disabled"
                          : ""
                      }`}
                      data-tooltip-id={
                        !gamemodeAvailable
                          ? "settings-gamemode-unavailable-tooltip"
                          : undefined
                      }
                      data-tooltip-content={
                        !gamemodeAvailable
                          ? tGameDetails("gamemode_not_available_tooltip", {
                              defaultValue:
                                "GameMode is not available in your PATH",
                            })
                          : undefined
                      }
                    >
                      <span>
                        {tGameDetails("run_with_gamemode_prefix", {
                          defaultValue: "Automatically run with",
                        })}
                      </span>
                      <Link
                        to={GAMEMODE_SITE_URL}
                        className="settings-behavior__gamemode-link"
                      >
                        GameMode
                        <LinkExternalIcon />
                      </Link>
                    </span>
                  }
                  checked={autoRunGamemode}
                  disabled={!gamemodeAvailable}
                  onChange={() =>
                    setAutoRunGamemode((previousValue) => {
                      const nextValue = !previousValue;
                      updateUserPreferences({ autoRunGamemode: nextValue });
                      return nextValue;
                    })
                  }
                />

                {!gamemodeAvailable && (
                  <Tooltip id="settings-gamemode-unavailable-tooltip" />
                )}
              </div>

              <div className="settings-behavior__mangohud-toggle">
                <CheckboxField
                  label={
                    <span
                      className={`settings-behavior__mangohud-label ${
                        !mangohudAvailable
                          ? "settings-behavior__mangohud-label--disabled"
                          : ""
                      }`}
                      data-tooltip-id={
                        !mangohudAvailable
                          ? "settings-mangohud-unavailable-tooltip"
                          : undefined
                      }
                      data-tooltip-content={
                        !mangohudAvailable
                          ? tGameDetails("mangohud_not_available_tooltip", {
                              defaultValue:
                                "MangoHud is not available in your PATH",
                            })
                          : undefined
                      }
                    >
                      <span>
                        {tGameDetails("run_with_mangohud_prefix", {
                          defaultValue: "Automatically run with",
                        })}
                      </span>
                      <Link
                        to={MANGOHUD_SITE_URL}
                        className="settings-behavior__mangohud-link"
                      >
                        MangoHud
                        <LinkExternalIcon />
                      </Link>
                    </span>
                  }
                  checked={autoRunMangohud}
                  disabled={!mangohudAvailable}
                  onChange={() =>
                    setAutoRunMangohud((previousValue) => {
                      const nextValue = !previousValue;
                      updateUserPreferences({ autoRunMangohud: nextValue });
                      return nextValue;
                    })
                  }
                />

                {!mangohudAvailable && (
                  <Tooltip id="settings-mangohud-unavailable-tooltip" />
                )}
              </div>
            </div>
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
