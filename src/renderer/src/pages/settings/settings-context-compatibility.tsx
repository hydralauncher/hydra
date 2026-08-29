import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GAMEMODE_SITE_URL, MANGOHUD_SITE_URL } from "@shared";

import {
  Button,
  CheckboxField,
  Link,
  ProtonPathPicker,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { ProtonVersion } from "@types";
import { DesktopDownloadIcon, LinkExternalIcon } from "@primer/octicons-react";

import "./settings-context-compatibility.scss";
import { logger } from "@renderer/logger";
import { Tooltip } from "react-tooltip";

import "./settings-behavior.scss";
import "./settings-general.scss";

interface CompatibilityToggleProps {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  tooltipId?: string;
  tooltipContent?: string;
  onChange: (value: boolean) => void;
}

function CompatibilityToggle({
  id,
  label,
  checked,
  disabled,
  tooltipId,
  tooltipContent,
  onChange,
}: Readonly<CompatibilityToggleProps>) {
  return (
    <div className="settings-context-compatibility__toggle">
      <CheckboxField
        id={id}
        label={
          <span
            className={
              disabled
                ? "settings-context-compatibility__toggle-label--disabled"
                : ""
            }
            data-tooltip-id={tooltipId}
            data-tooltip-content={tooltipContent}
          >
            {label}
          </span>
        }
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(!checked)}
      />
      {tooltipId && disabled && <Tooltip id={tooltipId} />}
    </div>
  );
}

let lastKnownCanInstallCommonRedist = false;

export function SettingsContextCompatibility() {
  const { t } = useTranslation("settings");
  const { t: tGameDetails } = useTranslation("game_details");
  const { updateUserPreferences } = useContext(settingsContext);
  const shouldShowCommonRedist = window.electron.platform === "win32";

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(
    () => lastKnownCanInstallCommonRedist
  );
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [protonVersionsLoaded, setProtonVersionsLoaded] = useState(false);
  const [selectedDefaultProtonPath, setSelectedDefaultProtonPath] = useState(
    () => userPreferences?.defaultProtonPath ?? ""
  );
  const [defaultWinePrefixBasePath, setDefaultWinePrefixBasePath] =
    useState("");
  const [defaultWinePrefixPath, setDefaultWinePrefixPath] = useState(
    () => userPreferences?.defaultWinePrefixPath ?? ""
  );

  const [autoRunMangohud, setAutoRunMangohud] = useState(
    () => userPreferences?.autoRunMangohud ?? false
  );
  const [autoRunGamemode, setAutoRunGamemode] = useState(
    () => userPreferences?.autoRunGamemode ?? false
  );
  const [protonLogEnabled, setProtonLogEnabled] = useState(
    () => userPreferences?.protonLogEnabled ?? false
  );
  const [
    compatibilityEnvironmentVariablesEnabled,
    setCompatibilityEnvironmentVariablesEnabled,
  ] = useState(
    () => userPreferences?.compatibilityEnvironmentVariablesEnabled ?? false
  );
  const [
    compatibilityEnvironmentVariables,
    setCompatibilityEnvironmentVariables,
  ] = useState(
    () => userPreferences?.compatibilityEnvironmentVariables ?? ""
  );
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);

  useEffect(() => {
    if (!shouldShowCommonRedist) return;

    const applyCanInstall = (canInstall: boolean) => {
      lastKnownCanInstallCommonRedist = canInstall;
      setCanInstallCommonRedist(canInstall);
    };

    window.electron.canInstallCommonRedist().then(applyCanInstall);

    const interval = setInterval(() => {
      window.electron.canInstallCommonRedist().then(applyCanInstall);
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
    setProtonLogEnabled(userPreferences.protonLogEnabled ?? false);
    setCompatibilityEnvironmentVariablesEnabled(
      userPreferences.compatibilityEnvironmentVariablesEnabled ?? false
    );
    setCompatibilityEnvironmentVariables(
      userPreferences.compatibilityEnvironmentVariables ?? ""
    );
    setDefaultWinePrefixPath(
      userPreferences.defaultWinePrefixPath ?? defaultWinePrefixBasePath
    );
  }, [defaultWinePrefixBasePath, userPreferences]);

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
    if (window.electron.platform !== "linux") {
      setDefaultWinePrefixBasePath("");
      return;
    }

    window.electron
      .getDefaultWinePrefixSelectionPath()
      .then((path) => {
        setDefaultWinePrefixBasePath(path ?? "");
      })
      .catch(() => {
        setDefaultWinePrefixBasePath("");
      });
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
  });

  const protonSourceUmuDefault = t("proton_source_umu_default", {
    ns: ["settings", "game_details"],
  });

  const protonSourceSteam = t("proton_source_steam", {
    ns: ["settings", "game_details"],
  });

  const protonSourceCompatibilityTools = t(
    "proton_source_compatibility_tools",
    {
      ns: ["settings", "game_details"],
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

  const handleChooseDefaultWinePrefixPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: defaultWinePrefixPath,
      properties: ["openDirectory"],
    });

    if (!filePaths.length) return;

    const nextPath = filePaths[0];
    setDefaultWinePrefixPath(nextPath);
    await updateUserPreferences({ defaultWinePrefixPath: nextPath });
  };

  const handleClearDefaultWinePrefixPath = async () => {
    await updateUserPreferences({ defaultWinePrefixPath: null });

    window.electron
      .getDefaultWinePrefixSelectionPath()
      .then((path) => {
        const resolvedPath = path ?? "";
        setDefaultWinePrefixBasePath(resolvedPath);
        setDefaultWinePrefixPath(resolvedPath);
      })
      .catch(() => {
        setDefaultWinePrefixPath(defaultWinePrefixBasePath);
      });
  };

  const hasCustomDefaultWinePrefixPath =
    userPreferences?.defaultWinePrefixPath != null;

  return (
    <div className="settings-context-panel settings-context-compatibility">
      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <div className="settings-context-compatibility__stack">
            <div className="settings-context-compatibility__section">
              <TextField
                label={t("default_wine_prefix", {
                  defaultValue: "Default Wine prefix location",
                })}
                value={defaultWinePrefixPath}
                readOnly
                disabled
                placeholder={t("no_directory_selected")}
                rightContent={
                  <>
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleChooseDefaultWinePrefixPath}
                    >
                      {t("change")}
                    </Button>
                    {hasCustomDefaultWinePrefixPath && (
                      <Button
                        type="button"
                        theme="outline"
                        onClick={handleClearDefaultWinePrefixPath}
                      >
                        {t("clear")}
                      </Button>
                    )}
                  </>
                }
              />
            </div>

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

              <CompatibilityToggle
                id="gamemode-toggle"
                label={
                  <>
                    <span>{tGameDetails("run_with_gamemode_prefix")}</span>
                    <Link
                      to={GAMEMODE_SITE_URL}
                      className="settings-context-compatibility__toggle-link"
                    >
                      GameMode
                      <LinkExternalIcon />
                    </Link>
                  </>
                }
                checked={autoRunGamemode}
                disabled={!gamemodeAvailable}
                tooltipId={
                  !gamemodeAvailable
                    ? "settings-gamemode-unavailable-tooltip"
                    : undefined
                }
                tooltipContent={
                  !gamemodeAvailable
                    ? tGameDetails("gamemode_not_available_tooltip", {
                        defaultValue: "GameMode is not available in your PATH",
                      })
                    : undefined
                }
                onChange={(nextValue) => {
                  setAutoRunGamemode(nextValue);
                  updateUserPreferences({ autoRunGamemode: nextValue });
                }}
              />

              <CompatibilityToggle
                id="mangohud-toggle"
                label={
                  <>
                    <span>{tGameDetails("run_with_mangohud_prefix")}</span>
                    <Link
                      to={MANGOHUD_SITE_URL}
                      className="settings-context-compatibility__toggle-link"
                    >
                      MangoHud
                      <LinkExternalIcon />
                    </Link>
                  </>
                }
                checked={autoRunMangohud}
                disabled={!mangohudAvailable}
                tooltipId={
                  !mangohudAvailable
                    ? "settings-mangohud-unavailable-tooltip"
                    : undefined
                }
                tooltipContent={
                  !mangohudAvailable
                    ? tGameDetails("mangohud_not_available_tooltip", {
                        defaultValue: "MangoHud is not available in your PATH",
                      })
                    : undefined
                }
                onChange={(nextValue) => {
                  setAutoRunMangohud(nextValue);
                  updateUserPreferences({ autoRunMangohud: nextValue });
                }}
              />

              <CompatibilityToggle
                id="proton-log-toggle"
                label={<span>{t("enable_proton_logging")}</span>}
                checked={protonLogEnabled}
                onChange={(nextValue) => {
                  setProtonLogEnabled(nextValue);
                  updateUserPreferences({ protonLogEnabled: nextValue });
                }}
              />

              <div className="settings-context-compatibility__env-vars">
                <CheckboxField
                  label={t("enable_compatibility_environment_variables")}
                  checked={compatibilityEnvironmentVariablesEnabled}
                  onChange={() =>
                    setCompatibilityEnvironmentVariablesEnabled(
                      (previousValue) => {
                        const nextValue = !previousValue;
                        updateUserPreferences({
                          compatibilityEnvironmentVariablesEnabled: nextValue,
                        });
                        return nextValue;
                      }
                    )
                  }
                />
                <label
                  className="settings-context-compatibility__env-vars-label"
                  htmlFor="compatibility-environment-variables"
                >
                  {t("compatibility_environment_variables")}
                </label>
                <textarea
                  id="compatibility-environment-variables"
                  className="settings-context-compatibility__textarea"
                  disabled={!compatibilityEnvironmentVariablesEnabled}
                  value={compatibilityEnvironmentVariables}
                  onChange={(event) =>
                    setCompatibilityEnvironmentVariables(event.target.value)
                  }
                  onBlur={() => {
                    const trimmedValue = compatibilityEnvironmentVariables
                      .split("\n")
                      .filter((line) => line.trim() !== "")
                      .join("\n");
                    setCompatibilityEnvironmentVariables(trimmedValue);
                    updateUserPreferences({
                      compatibilityEnvironmentVariables: trimmedValue || null,
                    });
                  }}
                  placeholder={t(
                    "compatibility_environment_variables_placeholder"
                  )}
                  rows={5}
                />
                <p className="settings-context-compatibility__env-vars-help">
                  {t("compatibility_environment_variables_description")}
                </p>
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
