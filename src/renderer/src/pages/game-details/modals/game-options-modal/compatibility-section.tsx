import { useTranslation } from "react-i18next";
import cn from "classnames";

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

interface ToggleTooltipOptions {
  managedBySteam: boolean;
  isAvailable: boolean;
  isEnabledGlobally: boolean;
  unavailableTooltipId: string;
  globalTooltipId: string;
  unavailableContent: string;
  globalContent: string;
}

const resolveToggleTooltip = ({
  managedBySteam,
  isAvailable,
  isEnabledGlobally,
  unavailableTooltipId,
  globalTooltipId,
  unavailableContent,
  globalContent,
}: ToggleTooltipOptions): { id?: string; content?: string } => {
  if (managedBySteam) return {};

  if (!isAvailable) {
    return { id: unavailableTooltipId, content: unavailableContent };
  }

  if (isEnabledGlobally) {
    return { id: globalTooltipId, content: globalContent };
  }

  return {};
};

interface SteamManagedNoticeProps {
  description: string;
  actionLabel: string;
  onOpenSteamGameProperties?: () => void;
}

function SteamManagedNotice({
  description,
  actionLabel,
  onOpenSteamGameProperties,
}: Readonly<SteamManagedNoticeProps>) {
  return (
    <div className="game-options-modal__steam-managed">
      <InfoIcon size={14} className="game-options-modal__steam-managed-icon" />
      <div className="game-options-modal__steam-managed-content">
        <p className="game-options-modal__steam-managed-description">
          {description}
        </p>
        <button
          type="button"
          className="game-options-modal__steam-managed-link"
          onClick={onOpenSteamGameProperties}
        >
          {actionLabel}
          <LinkExternalIcon size={12} />
        </button>
      </div>
    </div>
  );
}

interface LaunchToolToggleProps {
  toolName: string;
  toolSiteUrl: string;
  prefixLabel: string;
  wrapperClassName: string;
  labelClassName: string;
  linkClassName: string;
  tooltipId?: string;
  tooltipContent?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => Promise<void>;
}

function LaunchToolToggle({
  toolName,
  toolSiteUrl,
  prefixLabel,
  wrapperClassName,
  labelClassName,
  linkClassName,
  tooltipId,
  tooltipContent,
  checked,
  disabled,
  onChange,
}: Readonly<LaunchToolToggleProps>) {
  return (
    <div className={wrapperClassName}>
      <CheckboxField
        label={
          <span
            className={cn(labelClassName, {
              [`${labelClassName}--disabled`]: disabled,
            })}
            data-tooltip-id={tooltipId}
            data-tooltip-content={tooltipContent}
          >
            <span>{prefixLabel}</span>
            <Link to={toolSiteUrl} className={linkClassName}>
              {toolName}
              <LinkExternalIcon />
            </Link>
          </span>
        }
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />

      {disabled && tooltipId && <Tooltip id={tooltipId} />}
    </div>
  );
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

  const gamemodeTooltip = resolveToggleTooltip({
    managedBySteam,
    isAvailable: gamemodeAvailable,
    isEnabledGlobally: globalAutoRunGamemode,
    unavailableTooltipId: "gamemode-unavailable-tooltip",
    globalTooltipId: "gamemode-global-enabled-tooltip",
    unavailableContent: t("gamemode_not_available_tooltip", {
      defaultValue: "GameMode is not available in your PATH",
    }),
    globalContent: t("gamemode_disabled_due_to_global_setting_tooltip", {
      defaultValue:
        "This option is disabled because GameMode is enabled globally",
    }),
  });

  const mangohudTooltip = resolveToggleTooltip({
    managedBySteam,
    isAvailable: mangohudAvailable,
    isEnabledGlobally: globalAutoRunMangohud,
    unavailableTooltipId: "mangohud-unavailable-tooltip",
    globalTooltipId: "mangohud-global-enabled-tooltip",
    unavailableContent: t("mangohud_not_available_tooltip", {
      defaultValue: "MangoHud is not available in your PATH",
    }),
    globalContent: t("mangohud_disabled_due_to_global_setting_tooltip", {
      defaultValue:
        "This option is disabled because MangoHud is enabled globally",
    }),
  });

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

  const winePrefixDescription = managedBySteam
    ? t("wine_prefix_description_steam")
    : t("wine_prefix_description");

  const protonVersionDescription = managedBySteam
    ? t("proton_version_description_steam")
    : t("proton_version_description");

  return (
    <>
      {managedBySteam && (
        <SteamManagedNotice
          description={t("compatibility_managed_by_steam")}
          actionLabel={t("open_steam_game_properties")}
          onOpenSteamGameProperties={onOpenSteamGameProperties}
        />
      )}

      <div className="game-options-modal__wine-prefix">
        <div className="game-options-modal__header">
          <h2>{t("wine_prefix")}</h2>
          <h4 className="game-options-modal__header-description">
            {winePrefixDescription}
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
                disabled={managedBySteam}
                onClick={onChangeWinePrefixPath}
              >
                <FileDirectoryIcon />
                {t("select_executable")}
              </Button>
              {game.winePrefixPath && (
                <Button
                  onClick={onClearWinePrefixPath}
                  theme="outline"
                  disabled={managedBySteam}
                >
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

        <LaunchToolToggle
          toolName="GameMode"
          toolSiteUrl={gamemodeSiteUrl}
          prefixLabel={t("run_with_gamemode_prefix", {
            defaultValue: "Automatically run with",
          })}
          wrapperClassName="game-options-modal__gamemode-toggle"
          labelClassName="game-options-modal__gamemode-label"
          linkClassName="game-options-modal__gamemode-link"
          tooltipId={gamemodeTooltip.id}
          tooltipContent={gamemodeTooltip.content}
          checked={autoRunGamemode || globalAutoRunGamemode}
          disabled={gamemodeToggleDisabled}
          onChange={onChangeGamemodeState}
        />

        <LaunchToolToggle
          toolName="MangoHud"
          toolSiteUrl={mangohudSiteUrl}
          prefixLabel={t("run_with_mangohud_prefix", {
            defaultValue: "Automatically run with",
          })}
          wrapperClassName="game-options-modal__mangohud-toggle"
          labelClassName="game-options-modal__mangohud-label"
          linkClassName="game-options-modal__mangohud-link"
          tooltipId={mangohudTooltip.id}
          tooltipContent={mangohudTooltip.content}
          checked={autoRunMangohud || globalAutoRunMangohud}
          disabled={mangohudToggleDisabled}
          onChange={onChangeMangohudState}
        />
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("proton_version")}</h2>
          <h4 className="game-options-modal__header-description">
            {protonVersionDescription}
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
