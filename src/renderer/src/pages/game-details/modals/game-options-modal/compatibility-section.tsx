import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  ProtonPathPicker,
  TextField,
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
  protonLogEnabled: boolean;
  globalAutoRunGamemode: boolean;
  globalAutoRunMangohud: boolean;
  globalProtonLogEnabled: boolean;
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
  onChangeProtonLogState: (value: boolean) => Promise<void>;
  onChangeProtonVersion: (value: string) => void;
}

interface CompatibilityToggleRowProps {
  label: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  tooltipId?: string;
  tooltipContent?: string;
  onChange: (checked: boolean) => void;
}

function CompatibilityToggleRow({
  label,
  checked,
  disabled,
  tooltipId,
  tooltipContent,
  onChange,
}: Readonly<CompatibilityToggleRowProps>) {
  return (
    <div className="game-options-modal__mangohud-toggle">
      <CheckboxField
        label={
          <span
            className={`game-options-modal__mangohud-label ${
              disabled ? "game-options-modal__mangohud-label--disabled" : ""
            }`}
            data-tooltip-id={tooltipId}
            data-tooltip-content={tooltipContent}
          >
            {label}
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
  protonVersions,
  selectedProtonPath,
  autoRunGamemode,
  autoRunMangohud,
  protonLogEnabled,
  globalAutoRunGamemode,
  globalAutoRunMangohud,
  globalProtonLogEnabled,
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
  onChangeProtonLogState,
  onChangeProtonVersion,
}: Readonly<CompatibilitySettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const gamemodeToggleDisabled = !gamemodeAvailable || globalAutoRunGamemode;
  const mangohudToggleDisabled = !mangohudAvailable || globalAutoRunMangohud;
  const protonLogToggleDisabled = globalProtonLogEnabled;

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

  const protonLogTooltipId = globalProtonLogEnabled
    ? "proton-log-global-enabled-tooltip"
    : undefined;

  const gamemodeTooltipContent = !gamemodeAvailable
    ? t("gamemode_not_available_tooltip", {
        defaultValue: "GameMode is not available in your PATH",
      })
    : globalAutoRunGamemode
      ? t("gamemode_disabled_due_to_global_setting_tooltip", {
          defaultValue:
            "This option is disabled because GameMode is enabled globally",
        })
      : undefined;

  const mangohudTooltipContent = !mangohudAvailable
    ? t("mangohud_not_available_tooltip", {
        defaultValue: "MangoHud is not available in your PATH",
      })
    : globalAutoRunMangohud
      ? t("mangohud_disabled_due_to_global_setting_tooltip", {
          defaultValue:
            "This option is disabled because MangoHud is enabled globally",
        })
      : undefined;

  const protonLogTooltipContent = globalProtonLogEnabled
    ? t("proton_log_disabled_due_to_global_setting_tooltip", {
        defaultValue:
          "This option is disabled because Proton logging is enabled globally",
      })
    : undefined;

  const protonVersionAutoLabel = t("proton_version_auto", {
    ns: ["game_details", "settings"],
    defaultValue: "Auto (global default or umu default)",
  });

  const protonSourceUmuDefault = t("proton_source_umu_default", {
    ns: ["game_details", "settings"],
    defaultValue: "Uses the default UMU-managed Proton version.",
  });

  const protonSourceSteam = t("proton_source_steam", {
    ns: ["game_details", "settings"],
    defaultValue: "Proton installation found in Steam directories.",
  });

  const protonSourceCompatibilityTools = t(
    "proton_source_compatibility_tools",
    {
      ns: ["game_details", "settings"],
      defaultValue:
        "Proton installation found in compatibilitytools.d directories.",
    }
  );

  return (
    <>
      <div className="game-options-modal__section">
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
              {displayedWinePrefixPath && (
                <Button onClick={onClearWinePrefixPath} theme="outline">
                  {t("clear")}
                </Button>
              )}
            </>
          }
        />

        <div className="game-options-modal__row">
          <Button
            type="button"
            theme="outline"
            onClick={onOpenWinetricks}
            disabled={!winetricksAvailable}
          >
            {t("open_winetricks")}
          </Button>
        </div>
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("additional_options")}</h2>
        </div>

        <CompatibilityToggleRow
          label={
            <>
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
            </>
          }
          checked={autoRunGamemode || globalAutoRunGamemode}
          disabled={gamemodeToggleDisabled}
          tooltipId={gamemodeTooltipId}
          tooltipContent={gamemodeTooltipContent}
          onChange={(checked) => onChangeGamemodeState(checked)}
        />

        <CompatibilityToggleRow
          label={
            <>
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
            </>
          }
          checked={autoRunMangohud || globalAutoRunMangohud}
          disabled={mangohudToggleDisabled}
          tooltipId={mangohudTooltipId}
          tooltipContent={mangohudTooltipContent}
          onChange={(checked) => onChangeMangohudState(checked)}
        />

        <CompatibilityToggleRow
          label={<span>{t("proton_logging")}</span>}
          checked={protonLogEnabled || globalProtonLogEnabled}
          disabled={protonLogToggleDisabled}
          tooltipId={protonLogTooltipId}
          tooltipContent={protonLogTooltipContent}
          onChange={(checked) => onChangeProtonLogState(checked)}
        />
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
