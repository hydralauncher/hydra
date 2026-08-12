import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  ProtonPathPicker,
  TextField,
  SelectField,
} from "@renderer/components";
import type { LibraryGame, ProtonVersion } from "@types";
import { FileDirectoryIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

interface CompatibilitySettingsSectionProps {
  game: LibraryGame;
  displayedWinePrefixPath: string | null;
  protonVersions: ProtonVersion[];
  selectedProtonPath: string;
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
  autoRunGamescope: boolean;
  globalAutoRunGamemode: boolean;
  globalAutoRunMangohud: boolean;
  globalAutoRunGamescope: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  gamescopeAvailable: boolean;
  winetricksAvailable: boolean;
  mangohudSiteUrl: string;
  gamemodeSiteUrl: string;
  gamescopeSiteUrl: string;
  gamescopeResolution: string;
  gamescopeOutputResolution: string;
  gamescopeUpscaler: string;
  gamescopeFramerateLimit: string;
  onChangeWinePrefixPath: () => Promise<void>;
  onClearWinePrefixPath: () => Promise<void>;
  onOpenWinetricks: () => Promise<void>;
  onChangeGamemodeState: (value: boolean) => Promise<void>;
  onChangeMangohudState: (value: boolean) => Promise<void>;
  onChangeGamescopeState: (value: boolean) => Promise<void>;
  onChangeGamescopeSetting: (
    key:
      | "gamescopeResolution"
      | "gamescopeOutputResolution"
      | "gamescopeUpscaler"
      | "gamescopeFramerateLimit",
    value: string
  ) => void;
  onChangeProtonVersion: (value: string) => void;
}

export function CompatibilitySettingsSection({
  game,
  displayedWinePrefixPath,
  protonVersions,
  selectedProtonPath,
  autoRunGamemode,
  autoRunMangohud,
  autoRunGamescope,
  globalAutoRunGamemode,
  globalAutoRunMangohud,
  globalAutoRunGamescope,
  gamemodeAvailable,
  mangohudAvailable,
  gamescopeAvailable,
  winetricksAvailable,
  mangohudSiteUrl,
  gamemodeSiteUrl,
  gamescopeSiteUrl,
  gamescopeResolution,
  gamescopeOutputResolution,
  gamescopeUpscaler,
  gamescopeFramerateLimit,
  onChangeWinePrefixPath,
  onClearWinePrefixPath,
  onOpenWinetricks,
  onChangeGamemodeState,
  onChangeMangohudState,
  onChangeGamescopeState,
  onChangeGamescopeSetting,
  onChangeProtonVersion,
}: Readonly<CompatibilitySettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const showWinetricksUnavailableTooltip = !winetricksAvailable;
  const gamemodeToggleDisabled = !gamemodeAvailable || globalAutoRunGamemode;
  const mangohudToggleDisabled = !mangohudAvailable || globalAutoRunMangohud;
  const gamescopeToggleDisabled = !gamescopeAvailable || globalAutoRunGamescope;

  const gamemodeTooltipId = !gamemodeAvailable
    ? "gamemode-unavailable-tooltip"
    : globalAutoRunGamemode
      ? "gamemode-global-enabled-tooltip"
      : undefined;

  const mangohudTooltipId = !mangohudAvailable
    ? "mangohud-unavailable-tooltip"
    : globalAutoRunMangohud
      ? "mangohud-global-enabled-tooltip"
      : undefined;

  const gamescopeTooltipId = !gamescopeAvailable
    ? "gamescope-unavailable-tooltip"
    : globalAutoRunGamescope
      ? "gamescope-global-enabled-tooltip"
      : undefined;

  const protonVersionAutoLabel = t("proton_version_auto", {
    ns: ["game_details", "settings"],
    defaultValue: "Auto (global default or umu default)",
  });

  const protonSourceUmuDefault = t("proton_source_umu_default", {
    ns: ["game_details", "settings"],
    defaultValue: "umu default selection",
  });

  const protonSourceSteam = t("proton_source_steam", {
    ns: ["game_details", "settings"],
    defaultValue: "Installed by Steam",
  });

  const protonSourceCompatibilityTools = t(
    "proton_source_compatibility_tools",
    {
      ns: ["game_details", "settings"],
      defaultValue: "Installed in Steam compatibilitytools.d",
    }
  );

  return (
    <>
      <div className="game-options-modal__wine-prefix">
        <div className="game-options-modal__header">
          <h2>{t("wine_prefix")}</h2>
          <h4 className="game-options-modal__header-description">
            {t("wine_prefix_description")}
          </h4>
        </div>

        <TextField
          value={displayedWinePrefixPath || ""}
          readOnly
          theme="dark"
          disabled
          placeholder={t("no_directory_selected")}
          rightContent={
            <>
              <Button
                type="button"
                theme="outline"
                onClick={onChangeWinePrefixPath}
              >
                <FileDirectoryIcon />
                {t("select_executable")}
              </Button>
              {game.winePrefixPath && (
                <Button onClick={onClearWinePrefixPath} theme="outline">
                  {t("clear")}
                </Button>
              )}
            </>
          }
        />

        <div className="game-options-modal__row">
          <span
            className="game-options-modal__tool-button-wrapper"
            data-tooltip-id="winetricks-unavailable-tooltip"
            data-tooltip-content={
              showWinetricksUnavailableTooltip
                ? t("winetricks_not_available_tooltip")
                : undefined
            }
          >
            <Button
              type="button"
              theme="outline"
              onClick={onOpenWinetricks}
              disabled={!winetricksAvailable}
            >
              {t("open_winetricks")}
            </Button>
          </span>

          {showWinetricksUnavailableTooltip && (
            <Tooltip id="winetricks-unavailable-tooltip" />
          )}
        </div>
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("additional_options")}</h2>
        </div>

        <div className="game-options-modal__gamemode-toggle">
          <CheckboxField
            label={
              <span
                className={`game-options-modal__gamemode-label ${
                  gamemodeToggleDisabled
                    ? "game-options-modal__gamemode-label--disabled"
                    : ""
                }`}
                data-tooltip-id={gamemodeTooltipId}
                data-tooltip-content={
                  !gamemodeAvailable
                    ? t("gamemode_not_available_tooltip", {
                        defaultValue: "GameMode is not available in your PATH",
                      })
                    : globalAutoRunGamemode
                      ? t("gamemode_disabled_due_to_global_setting_tooltip", {
                          defaultValue:
                            "This option is disabled because GameMode is enabled globally",
                        })
                      : undefined
                }
              >
                <span>
                  {t("run_with_gamemode_prefix", {
                    defaultValue: "Automatically run with",
                  })}
                </span>
                <Link
                  to={gamemodeSiteUrl}
                  className="game-options-modal__gamemode-link"
                >
                  GameMode
                  <LinkExternalIcon />
                </Link>
              </span>
            }
            checked={autoRunGamemode || globalAutoRunGamemode}
            disabled={gamemodeToggleDisabled}
            onChange={(event) => onChangeGamemodeState(event.target.checked)}
          />

          {gamemodeToggleDisabled && gamemodeTooltipId && (
            <Tooltip id={gamemodeTooltipId} />
          )}
        </div>

        <div className="game-options-modal__mangohud-toggle">
          <CheckboxField
            label={
              <span
                className={`game-options-modal__mangohud-label ${
                  mangohudToggleDisabled
                    ? "game-options-modal__mangohud-label--disabled"
                    : ""
                }`}
                data-tooltip-id={mangohudTooltipId}
                data-tooltip-content={
                  !mangohudAvailable
                    ? t("mangohud_not_available_tooltip", {
                        defaultValue: "MangoHud is not available in your PATH",
                      })
                    : globalAutoRunMangohud
                      ? t("mangohud_disabled_due_to_global_setting_tooltip", {
                          defaultValue:
                            "This option is disabled because MangoHud is enabled globally",
                        })
                      : undefined
                }
              >
                <span>
                  {t("run_with_mangohud_prefix", {
                    defaultValue: "Automatically run with",
                  })}
                </span>
                <Link
                  to={mangohudSiteUrl}
                  className="game-options-modal__mangohud-link"
                >
                  MangoHud
                  <LinkExternalIcon />
                </Link>
              </span>
            }
            checked={autoRunMangohud || globalAutoRunMangohud}
            disabled={mangohudToggleDisabled}
            onChange={(event) => onChangeMangohudState(event.target.checked)}
          />

          {mangohudToggleDisabled && mangohudTooltipId && (
            <Tooltip id={mangohudTooltipId} />
          )}
        </div>

        <div className="game-options-modal__gamescope-toggle">
          <CheckboxField
            label={
              <span
                className={`game-options-modal__gamescope-label ${
                  gamescopeToggleDisabled
                    ? "game-options-modal__gamescope-label--disabled"
                    : ""
                }`}
                data-tooltip-id={gamescopeTooltipId}
                data-tooltip-content={
                  !gamescopeAvailable
                    ? t("gamescope_not_available_tooltip", {
                        defaultValue: "Gamescope is not available in your PATH",
                      })
                    : globalAutoRunGamescope
                      ? t("gamescope_disabled_due_to_global_setting_tooltip", {
                          defaultValue:
                            "This option is disabled because Gamescope is enabled globally",
                        })
                      : undefined
                }
              >
                <span>
                  {t("run_with_gamescope_prefix", {
                    defaultValue: "Automatically run with",
                  })}
                </span>
                <Link
                  to={gamescopeSiteUrl}
                  className="game-options-modal__gamescope-link"
                >
                  Gamescope
                  <LinkExternalIcon />
                </Link>
              </span>
            }
            checked={autoRunGamescope || globalAutoRunGamescope}
            disabled={gamescopeToggleDisabled}
            onChange={(event) => onChangeGamescopeState(event.target.checked)}
          />

          {gamescopeToggleDisabled && gamescopeTooltipId && (
            <Tooltip id={gamescopeTooltipId} />
          )}

          {(autoRunGamescope || globalAutoRunGamescope) && (
            <div className="game-options-modal__gamescope-settings">
              <div className="game-options-modal__row">
                <TextField
                  label={t("gamescope_resolution", {
                    defaultValue: "Game Resolution",
                  })}
                  value={gamescopeResolution}
                  onChange={(e) =>
                    onChangeGamescopeSetting(
                      "gamescopeResolution",
                      e.target.value
                    )
                  }
                  placeholder="e.g. 1280x720"
                />
                <TextField
                  label={t("gamescope_output_resolution", {
                    defaultValue: "Output Resolution",
                  })}
                  value={gamescopeOutputResolution}
                  onChange={(e) =>
                    onChangeGamescopeSetting(
                      "gamescopeOutputResolution",
                      e.target.value
                    )
                  }
                  placeholder="e.g. 1920x1080"
                />
              </div>
              <div className="game-options-modal__row">
                <SelectField
                  label={t("gamescope_upscaler", {
                    defaultValue: "Upscaling Filter",
                  })}
                  value={gamescopeUpscaler}
                  onChange={(e) =>
                    onChangeGamescopeSetting(
                      "gamescopeUpscaler",
                      e.target.value
                    )
                  }
                  options={[
                    {
                      key: "none",
                      label: t("none", { defaultValue: "None" }),
                      value: "",
                    },
                    { key: "linear", label: "Linear", value: "linear" },
                    { key: "nearest", label: "Nearest", value: "nearest" },
                    { key: "fsr", label: "FSR", value: "fsr" },
                    { key: "nis", label: "NIS", value: "nis" },
                    { key: "pixel", label: "Pixel", value: "pixel" },
                  ]}
                />
                <TextField
                  label={t("gamescope_framerate_limit", {
                    defaultValue: "Framerate Limit",
                  })}
                  value={gamescopeFramerateLimit}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, "");
                    onChangeGamescopeSetting("gamescopeFramerateLimit", val);
                  }}
                  placeholder="e.g. 60"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("proton_version")}</h2>
          <h4 className="game-options-modal__header-description">
            {t("proton_version_description")}
          </h4>
        </div>

        <ProtonPathPicker
          versions={protonVersions}
          selectedPath={selectedProtonPath}
          onChange={onChangeProtonVersion}
          radioName={`proton-version-${game.objectId}`}
          autoLabel={protonVersionAutoLabel}
          autoSourceDescription={protonSourceUmuDefault}
          steamSourceDescription={protonSourceSteam}
          compatibilityToolsSourceDescription={protonSourceCompatibilityTools}
        />
      </div>
    </>
  );
}
