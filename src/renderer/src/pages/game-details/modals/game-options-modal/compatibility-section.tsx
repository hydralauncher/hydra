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

import type { GamescopeSettingKey } from "./types";

interface CompatibilitySettingsSectionProps {
  game: LibraryGame;
  displayedWinePrefixPath: string | null;
  protonVersions: ProtonVersion[];
  selectedProtonPath: string;
  winetricksAvailable: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  gamescopeAvailable: boolean;
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
  autoRunGamescope: boolean;
  globalAutoRunGamemode: boolean;
  globalAutoRunMangohud: boolean;
  globalAutoRunGamescope: boolean;
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
  onChangeGamescopeSetting: (key: GamescopeSettingKey, value: string) => void;
  onChangeProtonVersion: (value: string) => void;
}

interface WinePrefixSectionProps {
  game: LibraryGame;
  displayedWinePrefixPath: string | null;
  winetricksAvailable: boolean;
  onChangeWinePrefixPath: () => Promise<void>;
  onClearWinePrefixPath: () => Promise<void>;
  onOpenWinetricks: () => Promise<void>;
}

function WinePrefixSection({
  game,
  displayedWinePrefixPath,
  winetricksAvailable,
  onChangeWinePrefixPath,
  onClearWinePrefixPath,
  onOpenWinetricks,
}: Readonly<WinePrefixSectionProps>) {
  const { t } = useTranslation("game_details");
  const showWinetricksUnavailableTooltip = !winetricksAvailable;

  return (
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
  );
}

interface GamescopeSettingsInputsProps {
  gamescopeResolution: string;
  gamescopeOutputResolution: string;
  gamescopeUpscaler: string;
  gamescopeFramerateLimit: string;
  onChangeGamescopeSetting: (key: GamescopeSettingKey, value: string) => void;
}

function GamescopeSettingsInputs({
  gamescopeResolution,
  gamescopeOutputResolution,
  gamescopeUpscaler,
  gamescopeFramerateLimit,
  onChangeGamescopeSetting,
}: Readonly<GamescopeSettingsInputsProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="game-options-modal__gamescope-settings">
      <div className="game-options-modal__row">
        <TextField
          label={t("gamescope_resolution", {
            defaultValue: "Game Resolution",
          })}
          value={gamescopeResolution}
          onChange={(e) =>
            onChangeGamescopeSetting("gamescopeResolution", e.target.value)
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
            onChangeGamescopeSetting("gamescopeUpscaler", e.target.value)
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
            const val = e.target.value.replace(/\D/g, "");
            onChangeGamescopeSetting("gamescopeFramerateLimit", val);
          }}
          placeholder="e.g. 60"
        />
      </div>
    </div>
  );
}

function getTooltipProps(
  available: boolean,
  globalAutoRun: boolean,
  type: "gamemode" | "mangohud" | "gamescope"
) {
  const disabled = !available || globalAutoRun;

  let tooltipId: string | undefined = undefined;
  if (!available) {
    tooltipId = `${type}-unavailable-tooltip`;
  } else if (globalAutoRun) {
    tooltipId = `${type}-global-enabled-tooltip`;
  }

  let tooltipContentKey: string | undefined = undefined;
  if (!available) {
    tooltipContentKey = `${type}_not_available_tooltip`;
  } else if (globalAutoRun) {
    tooltipContentKey = `${type}_disabled_due_to_global_setting_tooltip`;
  }

  return { disabled, tooltipId, tooltipContentKey };
}

interface AdditionalOptionsSectionProps {
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
  autoRunGamescope: boolean;
  globalAutoRunGamemode: boolean;
  globalAutoRunMangohud: boolean;
  globalAutoRunGamescope: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  gamescopeAvailable: boolean;
  mangohudSiteUrl: string;
  gamemodeSiteUrl: string;
  gamescopeSiteUrl: string;
  gamescopeResolution: string;
  gamescopeOutputResolution: string;
  gamescopeUpscaler: string;
  gamescopeFramerateLimit: string;
  onChangeGamemodeState: (value: boolean) => Promise<void>;
  onChangeMangohudState: (value: boolean) => Promise<void>;
  onChangeGamescopeState: (value: boolean) => Promise<void>;
  onChangeGamescopeSetting: (key: GamescopeSettingKey, value: string) => void;
}

function AdditionalOptionsSection({
  autoRunGamemode,
  autoRunMangohud,
  autoRunGamescope,
  globalAutoRunGamemode,
  globalAutoRunMangohud,
  globalAutoRunGamescope,
  gamemodeAvailable,
  mangohudAvailable,
  gamescopeAvailable,
  mangohudSiteUrl,
  gamemodeSiteUrl,
  gamescopeSiteUrl,
  gamescopeResolution,
  gamescopeOutputResolution,
  gamescopeUpscaler,
  gamescopeFramerateLimit,
  onChangeGamemodeState,
  onChangeMangohudState,
  onChangeGamescopeState,
  onChangeGamescopeSetting,
}: Readonly<AdditionalOptionsSectionProps>) {
  const { t } = useTranslation("game_details");

  const gamemodeProps = getTooltipProps(
    gamemodeAvailable,
    globalAutoRunGamemode,
    "gamemode"
  );
  const mangohudProps = getTooltipProps(
    mangohudAvailable,
    globalAutoRunMangohud,
    "mangohud"
  );
  const gamescopeProps = getTooltipProps(
    gamescopeAvailable,
    globalAutoRunGamescope,
    "gamescope"
  );

  return (
    <div className="game-options-modal__section">
      <div className="game-options-modal__header">
        <h2>{t("additional_options")}</h2>
      </div>

      <div className="game-options-modal__gamemode-toggle">
        <CheckboxField
          label={
            <span
              className={`game-options-modal__gamemode-label ${
                gamemodeProps.disabled
                  ? "game-options-modal__gamemode-label--disabled"
                  : ""
              }`}
              data-tooltip-id={gamemodeProps.tooltipId}
              data-tooltip-content={
                gamemodeProps.tooltipContentKey
                  ? t(gamemodeProps.tooltipContentKey)
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
          disabled={gamemodeProps.disabled}
          onChange={(event) => onChangeGamemodeState(event.target.checked)}
        />

        {gamemodeProps.disabled && gamemodeProps.tooltipId && (
          <Tooltip id={gamemodeProps.tooltipId} />
        )}
      </div>

      <div className="game-options-modal__mangohud-toggle">
        <CheckboxField
          label={
            <span
              className={`game-options-modal__mangohud-label ${
                mangohudProps.disabled
                  ? "game-options-modal__mangohud-label--disabled"
                  : ""
              }`}
              data-tooltip-id={mangohudProps.tooltipId}
              data-tooltip-content={
                mangohudProps.tooltipContentKey
                  ? t(mangohudProps.tooltipContentKey)
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
          disabled={mangohudProps.disabled}
          onChange={(event) => onChangeMangohudState(event.target.checked)}
        />

        {mangohudProps.disabled && mangohudProps.tooltipId && (
          <Tooltip id={mangohudProps.tooltipId} />
        )}
      </div>

      <div className="game-options-modal__gamescope-toggle">
        <CheckboxField
          label={
            <span
              className={`game-options-modal__gamescope-label ${
                gamescopeProps.disabled
                  ? "game-options-modal__gamescope-label--disabled"
                  : ""
              }`}
              data-tooltip-id={gamescopeProps.tooltipId}
              data-tooltip-content={
                gamescopeProps.tooltipContentKey
                  ? t(gamescopeProps.tooltipContentKey)
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
          disabled={gamescopeProps.disabled}
          onChange={(event) => onChangeGamescopeState(event.target.checked)}
        />

        {gamescopeProps.disabled && gamescopeProps.tooltipId && (
          <Tooltip id={gamescopeProps.tooltipId} />
        )}

        {(autoRunGamescope || globalAutoRunGamescope) && (
          <GamescopeSettingsInputs
            gamescopeResolution={gamescopeResolution}
            gamescopeOutputResolution={gamescopeOutputResolution}
            gamescopeUpscaler={gamescopeUpscaler}
            gamescopeFramerateLimit={gamescopeFramerateLimit}
            onChangeGamescopeSetting={onChangeGamescopeSetting}
          />
        )}
      </div>
    </div>
  );
}

interface ProtonVersionSectionProps {
  game: LibraryGame;
  protonVersions: ProtonVersion[];
  selectedProtonPath: string;
  onChangeProtonVersion: (value: string) => void;
}

function ProtonVersionSection({
  game,
  protonVersions,
  selectedProtonPath,
  onChangeProtonVersion,
}: Readonly<ProtonVersionSectionProps>) {
  const { t } = useTranslation("game_details");

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
  );
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
  return (
    <>
      <WinePrefixSection
        game={game}
        displayedWinePrefixPath={displayedWinePrefixPath}
        winetricksAvailable={winetricksAvailable}
        onChangeWinePrefixPath={onChangeWinePrefixPath}
        onClearWinePrefixPath={onClearWinePrefixPath}
        onOpenWinetricks={onOpenWinetricks}
      />

      <AdditionalOptionsSection
        autoRunGamemode={autoRunGamemode}
        autoRunMangohud={autoRunMangohud}
        autoRunGamescope={autoRunGamescope}
        globalAutoRunGamemode={globalAutoRunGamemode}
        globalAutoRunMangohud={globalAutoRunMangohud}
        globalAutoRunGamescope={globalAutoRunGamescope}
        gamemodeAvailable={gamemodeAvailable}
        mangohudAvailable={mangohudAvailable}
        gamescopeAvailable={gamescopeAvailable}
        mangohudSiteUrl={mangohudSiteUrl}
        gamemodeSiteUrl={gamemodeSiteUrl}
        gamescopeSiteUrl={gamescopeSiteUrl}
        gamescopeResolution={gamescopeResolution}
        gamescopeOutputResolution={gamescopeOutputResolution}
        gamescopeUpscaler={gamescopeUpscaler}
        gamescopeFramerateLimit={gamescopeFramerateLimit}
        onChangeGamemodeState={onChangeGamemodeState}
        onChangeMangohudState={onChangeMangohudState}
        onChangeGamescopeState={onChangeGamescopeState}
        onChangeGamescopeSetting={onChangeGamescopeSetting}
      />

      <ProtonVersionSection
        game={game}
        protonVersions={protonVersions}
        selectedProtonPath={selectedProtonPath}
        onChangeProtonVersion={onChangeProtonVersion}
      />
    </>
  );
}
