import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  ProtonPathPicker,
  TextField,
} from "@renderer/components";
import type { LibraryGame, ProtonVersion } from "@types";
import {
  FileDirectoryIcon,
  InfoIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

interface CompatibilitySettingsSectionProps {
  game: LibraryGame;
  displayedWinePrefixPath: string | null;
  steamAppId?: string | null;
  onOpenSteamGameProperties?: () => void;
  protonVersions: ProtonVersion[];
  selectedProtonPath: string;
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
  globalAutoRunGamemode: boolean;
  globalAutoRunMangohud: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  winetricksAvailable: boolean;
  mangohudSiteUrl: string;
  gamemodeSiteUrl: string;
  onChangeWinePrefixPath: () => Promise<void>;
  onClearWinePrefixPath: () => Promise<void>;
  onOpenWinetricks: () => Promise<void>;
  onChangeGamemodeState: (value: boolean) => Promise<void>;
  onChangeMangohudState: (value: boolean) => Promise<void>;
  onChangeProtonVersion: (value: string) => void;
}

export function CompatibilitySettingsSection({
  game,
  displayedWinePrefixPath,
  steamAppId = null,
  onOpenSteamGameProperties,
  protonVersions,
  selectedProtonPath,
  autoRunGamemode,
  autoRunMangohud,
  globalAutoRunGamemode,
  globalAutoRunMangohud,
  gamemodeAvailable,
  mangohudAvailable,
  winetricksAvailable,
  mangohudSiteUrl,
  gamemodeSiteUrl,
  onChangeWinePrefixPath,
  onClearWinePrefixPath,
  onOpenWinetricks,
  onChangeGamemodeState,
  onChangeMangohudState,
  onChangeProtonVersion,
}: Readonly<CompatibilitySettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const managedBySteam = Boolean(steamAppId);
  const showWinetricksUnavailableTooltip =
    !winetricksAvailable && !managedBySteam;
  const gamemodeToggleDisabled =
    managedBySteam || !gamemodeAvailable || globalAutoRunGamemode;
  const mangohudToggleDisabled =
    managedBySteam || !mangohudAvailable || globalAutoRunMangohud;

  const gamemodeTooltipId = managedBySteam
    ? undefined
    : !gamemodeAvailable
      ? "gamemode-unavailable-tooltip"
      : globalAutoRunGamemode
        ? "gamemode-global-enabled-tooltip"
        : undefined;

  const mangohudTooltipId = managedBySteam
    ? undefined
    : !mangohudAvailable
      ? "mangohud-unavailable-tooltip"
      : globalAutoRunMangohud
        ? "mangohud-global-enabled-tooltip"
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
      {managedBySteam && (
        <div className="game-options-modal__steam-managed">
          <InfoIcon className="game-options-modal__steam-managed-icon" />
          <div className="game-options-modal__steam-managed-content">
            <p className="game-options-modal__steam-managed-description">
              {t("compatibility_managed_by_steam")}
            </p>
            <Button
              type="button"
              theme="outline"
              onClick={onOpenSteamGameProperties}
            >
              {t("open_steam_game_properties")}
              <LinkExternalIcon />
            </Button>
          </div>
        </div>
      )}

      <div className="game-options-modal__wine-prefix">
        <div className="game-options-modal__header">
          <h2>{t("wine_prefix")}</h2>
          <h4 className="game-options-modal__header-description">
            {managedBySteam
              ? t("wine_prefix_description_steam")
              : t("wine_prefix_description")}
          </h4>
        </div>

        <TextField
          value={displayedWinePrefixPath || ""}
          readOnly
          theme="dark"
          disabled
          placeholder={t("no_directory_selected")}
          rightContent={
            !managedBySteam && (
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
            )
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
              disabled={managedBySteam || !winetricksAvailable}
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
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("proton_version")}</h2>
          <h4 className="game-options-modal__header-description">
            {managedBySteam
              ? t("proton_version_description_steam")
              : t("proton_version_description")}
          </h4>
        </div>

        <ProtonPathPicker
          versions={protonVersions}
          selectedPath={selectedProtonPath}
          disabled={managedBySteam}
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
