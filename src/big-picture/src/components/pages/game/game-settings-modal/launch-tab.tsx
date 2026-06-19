import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  getSkuRegion,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import type { LibraryGame, ShortcutLocation } from "@types";
import { DiscIcon } from "@phosphor-icons/react";
import { FolderOpen, HardDrive, Monitor, Trash } from "lucide-react";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  DropdownSelect,
  FocusItem,
  HorizontalFocusGroup,
  Input,
  Tooltip,
  Typography,
  VerticalFocusGroup,
} from "../../../common";
import { SettingsSection } from "../../../../pages/settings/settings-section";

import "./launch-tab.scss";

export const GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID =
  "game-launch-settings-primary-control";

const GAME_LAUNCH_SETTINGS_OPTIONS_INPUT_ID =
  "game-launch-settings-options-input";
const GAME_LAUNCH_SETTINGS_OPTIONS_CLEAR_ID =
  "game-launch-settings-options-clear";
const GAME_LAUNCH_SETTINGS_SHORTCUT_DESKTOP_ID =
  "game-launch-settings-shortcut-desktop";
const GAME_LAUNCH_SETTINGS_SHORTCUT_STEAM_ID =
  "game-launch-settings-shortcut-steam";
const GAME_LAUNCH_SETTINGS_SHORTCUT_START_MENU_ID =
  "game-launch-settings-shortcut-start-menu";
const GAME_LAUNCH_SETTINGS_ADD_DISC_FILE_ID =
  "game-launch-settings-add-disc-file";
const GAME_LAUNCH_SETTINGS_DONT_ASK_DISC_ID =
  "game-launch-settings-dont-ask-disc";
const GAME_LAUNCH_SETTINGS_EXEC_PATH_SELECT_ID =
  "game-launch-settings-exec-path-select";
const GAME_LAUNCH_SETTINGS_EXEC_PATH_CLEAR_ID =
  "game-launch-settings-exec-path-clear";
const GAME_LAUNCH_SETTINGS_SAVE_FOLDER_ID = "game-launch-settings-save-folder";

const REGION_LABELS: Record<SkuRegion, string> = {
  US: "United States",
  EU: "Europe",
  JP: "Japan",
  KR: "Korea",
  ASIA: "Asia",
};

function getSaveFolderTooltipContent(
  loadingSaveFolder: boolean,
  saveFolderPath: string | null,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (loadingSaveFolder) {
    return t("searching_save_folder");
  }

  if (saveFolderPath) {
    return t("open_save_folder");
  }

  return t("no_save_folder_found");
}

export interface GameLaunchSettingsProps {
  game: LibraryGame;
  launchOptions: string;
  loadingSaveFolder: boolean;
  saveFolderPath: string | null;
  creatingSteamShortcut: boolean;
  steamShortcutExists: boolean;
  shouldShowCreateStartMenuShortcut: boolean;
  onChangeExecutableLocation: () => Promise<void>;
  onClearExecutablePath: () => Promise<void>;
  onOpenSaveFolder: () => Promise<void>;
  onChangeLaunchOptions: (value: string) => void;
  onBlurLaunchOptions: () => void;
  onClearLaunchOptions: () => void;
  onCreateShortcut: (location: ShortcutLocation) => Promise<void>;
  onCreateSteamShortcut: () => Promise<void>;
  onDeleteSteamShortcut: () => Promise<void>;
  onSelectDisc: (path: string) => Promise<void>;
  onToggleDontAskDiscSelection: (checked: boolean) => Promise<void>;
  onAddDiscFile: () => Promise<void>;
  onRemoveSelectedDisc: () => Promise<void>;
  onRemoveAllDiscs: () => Promise<void>;
}

interface LaunchboxDiscsSectionProps {
  discs: LibraryGame["discs"];
  selectedDisc: NonNullable<LibraryGame["discs"]>[number] | null;
  dontAskDiscSelection: LibraryGame["dontAskDiscSelection"];
  onSelectDisc: (path: string) => Promise<void>;
  onAddDiscFile: () => Promise<void>;
  onRemoveSelectedDisc: () => Promise<void>;
  onRemoveAllDiscs: () => Promise<void>;
  onToggleDontAskDiscSelection: (checked: boolean) => Promise<void>;
}

function LaunchboxDiscsSection({
  discs,
  selectedDisc,
  dontAskDiscSelection,
  onSelectDisc,
  onAddDiscFile,
  onRemoveSelectedDisc,
  onRemoveAllDiscs,
  onToggleDontAskDiscSelection,
}: Readonly<LaunchboxDiscsSectionProps>) {
  const { t } = useTranslation("game_details");
  const hasDiscs = discs && discs.length > 0;

  return (
    <SettingsSection
      className="game-launch-settings-tab__section"
      title={t("discs_section_title")}
      description={t("discs_section_description")}
    >
      <div className="game-launch-settings-tab__section-content">
        {hasDiscs && selectedDisc ? (
          <DropdownSelect
            focusId={GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID}
            ariaLabel={t("discs_section_title")}
            value={selectedDisc.path}
            options={discs.map((disc) => {
              const region = disc.sku ? getSkuRegion(disc.sku) : null;

              return {
                value: disc.path,
                label: disc.label,
                description: disc.fileName,
                icon: region ? (
                  <img
                    src={getSkuRegionFlag(region)}
                    alt={REGION_LABELS[region]}
                    title={REGION_LABELS[region]}
                  />
                ) : undefined,
              };
            })}
            onValueChange={(value) => {
              void onSelectDisc(value);
            }}
          />
        ) : (
          <>
            <Typography className="game-launch-settings-tab__empty-state">
              {t("no_discs_found")}
            </Typography>

            <Button
              focusId={GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID}
              variant="primary"
              icon={<DiscIcon size={20} />}
              onClick={() => {
                void onAddDiscFile();
              }}
            >
              {t("add_disc")}
            </Button>
          </>
        )}

        {hasDiscs ? (
          <HorizontalFocusGroup className="game-launch-settings-tab__actions game-launch-settings-tab__actions--thirds">
            <Button
              focusId={GAME_LAUNCH_SETTINGS_ADD_DISC_FILE_ID}
              variant="secondary"
              icon={<DiscIcon size={20} />}
              onClick={() => {
                void onAddDiscFile();
              }}
            >
              {t("add_disc")}
            </Button>

            {selectedDisc ? (
              <Button
                variant="danger"
                icon={<Trash size={16} />}
                onClick={() => {
                  void onRemoveSelectedDisc();
                }}
              >
                {t("remove_selected_disc")}
              </Button>
            ) : null}

            <Button
              variant="danger"
              icon={<Trash size={16} />}
              onClick={() => {
                void onRemoveAllDiscs();
              }}
            >
              {t("remove_all_discs")}
            </Button>
          </HorizontalFocusGroup>
        ) : null}

        {hasDiscs ? (
          <Checkbox
            block
            focusId={GAME_LAUNCH_SETTINGS_DONT_ASK_DISC_ID}
            label={t("dont_ask_disc_again")}
            checked={Boolean(dontAskDiscSelection)}
            onChange={(checked) => {
              void onToggleDontAskDiscSelection(checked);
            }}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}

interface ExecutableSectionProps {
  executablePath: LibraryGame["executablePath"];
  showSaveFolderButton: boolean;
  saveFolderTooltipContent: string;
  loadingSaveFolder: boolean;
  saveFolderPath: string | null;
  onChangeExecutableLocation: () => Promise<void>;
  onClearExecutablePath: () => Promise<void>;
  onOpenSaveFolder: () => Promise<void>;
}

function ExecutableSection({
  executablePath,
  showSaveFolderButton,
  saveFolderTooltipContent,
  loadingSaveFolder,
  saveFolderPath,
  onChangeExecutableLocation,
  onClearExecutablePath,
  onOpenSaveFolder,
}: Readonly<ExecutableSectionProps>) {
  const { t } = useTranslation("game_details");

  return (
    <SettingsSection
      className="game-launch-settings-tab__section"
      title={t("executable_section_title")}
      description={t("executable_section_description")}
    >
      <div className="game-launch-settings-tab__section-content">
        <HorizontalFocusGroup
          className="game-launch-settings-tab__exec-path-group"
          asChild
        >
          <div>
            <FocusItem
              id={GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID}
              actions={{ primary: () => void onChangeExecutableLocation() }}
              asChild
            >
              <button
                type="button"
                className={`game-launch-settings-tab__exec-path-button${
                  executablePath
                    ? ""
                    : " game-launch-settings-tab__exec-path-button--placeholder"
                }`}
                onClick={() => void onChangeExecutableLocation()}
              >
                {executablePath ?? t("no_executable_selected")}
              </button>
            </FocusItem>

            {executablePath ? (
              <Button
                focusId={GAME_LAUNCH_SETTINGS_EXEC_PATH_CLEAR_ID}
                variant="danger"
                icon={<Trash size={16} />}
                onClick={() => void onClearExecutablePath()}
                focusNavigationOverrides={{
                  left: {
                    type: "item",
                    itemId: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
                  },
                }}
              >
                Clear Path
              </Button>
            ) : (
              <Button
                focusId={GAME_LAUNCH_SETTINGS_EXEC_PATH_SELECT_ID}
                variant="secondary"
                icon={<FolderOpen size={16} />}
                onClick={() => void onChangeExecutableLocation()}
                focusNavigationOverrides={{
                  left: {
                    type: "item",
                    itemId: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
                  },
                }}
              >
                Select Path
              </Button>
            )}

            {showSaveFolderButton ? (
              <Tooltip content={saveFolderTooltipContent}>
                <Button
                  focusId={GAME_LAUNCH_SETTINGS_SAVE_FOLDER_ID}
                  variant="secondary"
                  size="icon"
                  aria-label={t("open_save_folder")}
                  disabled={loadingSaveFolder || !saveFolderPath}
                  icon={<HardDrive size={16} />}
                  onClick={() => {
                    void onOpenSaveFolder();
                  }}
                  focusNavigationOverrides={{
                    left: {
                      type: "item",
                      itemId: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
                    },
                  }}
                >
                  {null}
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </HorizontalFocusGroup>
      </div>
    </SettingsSection>
  );
}

interface ShortcutSectionProps {
  isCustomGame: boolean;
  shouldShowCreateStartMenuShortcut: boolean;
  creatingSteamShortcut: boolean;
  steamShortcutExists: boolean;
  onCreateShortcut: (location: ShortcutLocation) => Promise<void>;
  onCreateSteamShortcut: () => Promise<void>;
  onDeleteSteamShortcut: () => Promise<void>;
}

function ShortcutSection({
  isCustomGame,
  shouldShowCreateStartMenuShortcut,
  creatingSteamShortcut,
  steamShortcutExists,
  onCreateShortcut,
  onCreateSteamShortcut,
  onDeleteSteamShortcut,
}: Readonly<ShortcutSectionProps>) {
  const { t } = useTranslation("game_details");

  let steamShortcutButton: ReactNode = null;

  if (!isCustomGame) {
    steamShortcutButton = steamShortcutExists ? (
      <Button
        focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_STEAM_ID}
        variant="danger"
        loading={creatingSteamShortcut}
        icon={<SteamLogo />}
        onClick={() => {
          onDeleteSteamShortcut().catch(() => {});
        }}
        focusNavigationOverrides={{
          left: {
            type: "item",
            itemId: GAME_LAUNCH_SETTINGS_SHORTCUT_DESKTOP_ID,
          },
        }}
      >
        {t("delete_steam_shortcut")}
      </Button>
    ) : (
      <Button
        focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_STEAM_ID}
        variant="secondary"
        loading={creatingSteamShortcut}
        icon={<SteamLogo />}
        onClick={() => {
          onCreateSteamShortcut().catch(() => {});
        }}
        focusNavigationOverrides={{
          left: {
            type: "item",
            itemId: GAME_LAUNCH_SETTINGS_SHORTCUT_DESKTOP_ID,
          },
        }}
      >
        {t("create_steam_shortcut")}
      </Button>
    );
  }

  return (
    <SettingsSection
      className="game-launch-settings-tab__section"
      title={t("shortcuts_section_title")}
      description={t("shortcuts_section_description")}
    >
      <div className="game-launch-settings-tab__section-content">
        <HorizontalFocusGroup className="game-launch-settings-tab__shortcuts-row">
          <Button
            focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_DESKTOP_ID}
            variant="secondary"
            icon={<Monitor size={16} />}
            onClick={() => {
              void onCreateShortcut("desktop");
            }}
          >
            {t("create_shortcut")}
          </Button>

          {steamShortcutButton}

          {shouldShowCreateStartMenuShortcut ? (
            <Button
              focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_START_MENU_ID}
              variant="secondary"
              onClick={() => {
                void onCreateShortcut("start_menu");
              }}
              focusNavigationOverrides={{
                left: {
                  type: "item",
                  itemId: isCustomGame
                    ? GAME_LAUNCH_SETTINGS_SHORTCUT_DESKTOP_ID
                    : GAME_LAUNCH_SETTINGS_SHORTCUT_STEAM_ID,
                },
              }}
            >
              {t("create_start_menu_shortcut")}
            </Button>
          ) : null}
        </HorizontalFocusGroup>
      </div>
    </SettingsSection>
  );
}

interface LaunchOptionsSectionProps {
  launchOptions: string;
  onChangeLaunchOptions: (value: string) => void;
  onBlurLaunchOptions: () => void;
  onClearLaunchOptions: () => void;
}

function LaunchOptionsSection({
  launchOptions,
  onChangeLaunchOptions,
  onBlurLaunchOptions,
  onClearLaunchOptions,
}: Readonly<LaunchOptionsSectionProps>) {
  const { t } = useTranslation("game_details");
  const isLinux = globalThis.window.electron.platform === "linux";
  const description = isLinux ? (
    <Trans
      i18nKey="launch_options_description_linux"
      ns="game_details"
      defaults="Add game launch arguments, or use <code>%command%</code> to wrap the launch command."
      components={{
        code: <code className="game-launch-settings-tab__inline-code" />,
      }}
    />
  ) : (
    t("launch_options_description")
  );

  return (
    <SettingsSection
      className="game-launch-settings-tab__section"
      title={t("launch_options")}
      description={description}
    >
      <div className="game-launch-settings-tab__section-content">
        <HorizontalFocusGroup
          className="game-launch-settings-tab__launch-options-row"
          asChild
        >
          <div>
            <Input
              focusId={GAME_LAUNCH_SETTINGS_OPTIONS_INPUT_ID}
              className="game-launch-settings-tab__launch-options-input"
              value={launchOptions}
              placeholder={t("launch_options_placeholder")}
              onChange={(event) => onChangeLaunchOptions(event.target.value)}
              onBlur={onBlurLaunchOptions}
            />

            <Button
              focusId={GAME_LAUNCH_SETTINGS_OPTIONS_CLEAR_ID}
              variant="danger"
              icon={<Trash size={16} />}
              disabled={launchOptions.trim().length === 0}
              onClick={() => {
                onClearLaunchOptions();
              }}
              focusNavigationOverrides={{
                left: {
                  type: "item",
                  itemId: GAME_LAUNCH_SETTINGS_OPTIONS_INPUT_ID,
                },
              }}
            >
              Clear Args
            </Button>
          </div>
        </HorizontalFocusGroup>
      </div>
    </SettingsSection>
  );
}

export function GameLaunchSettingsTab({
  game,
  launchOptions,
  loadingSaveFolder,
  saveFolderPath,
  creatingSteamShortcut,
  steamShortcutExists,
  shouldShowCreateStartMenuShortcut,
  onChangeExecutableLocation,
  onClearExecutablePath,
  onOpenSaveFolder,
  onChangeLaunchOptions,
  onBlurLaunchOptions,
  onClearLaunchOptions,
  onCreateShortcut,
  onCreateSteamShortcut,
  onDeleteSteamShortcut,
  onSelectDisc,
  onToggleDontAskDiscSelection,
  onAddDiscFile,
  onRemoveSelectedDisc,
  onRemoveAllDiscs,
}: Readonly<GameLaunchSettingsProps>) {
  const { t } = useTranslation("game_details");
  const isCustomGame = game.shop === "custom";
  const discs = game.discs ?? [];
  const selectedDisc =
    discs.find((disc) => disc.path === game.selectedDiscPath) ??
    discs[0] ??
    null;
  const showSaveFolderButton =
    !isCustomGame && globalThis.window.electron.platform === "win32";
  const saveFolderTooltipContent = getSaveFolderTooltipContent(
    loadingSaveFolder,
    saveFolderPath,
    t
  );

  return (
    <VerticalFocusGroup className="game-launch-settings-tab">
      {game.shop === "launchbox" ? (
        <LaunchboxDiscsSection
          discs={discs}
          selectedDisc={selectedDisc}
          dontAskDiscSelection={game.dontAskDiscSelection}
          onSelectDisc={onSelectDisc}
          onAddDiscFile={onAddDiscFile}
          onRemoveSelectedDisc={onRemoveSelectedDisc}
          onRemoveAllDiscs={onRemoveAllDiscs}
          onToggleDontAskDiscSelection={onToggleDontAskDiscSelection}
        />
      ) : (
        <ExecutableSection
          executablePath={game.executablePath}
          showSaveFolderButton={showSaveFolderButton}
          saveFolderTooltipContent={saveFolderTooltipContent}
          loadingSaveFolder={loadingSaveFolder}
          saveFolderPath={saveFolderPath}
          onChangeExecutableLocation={onChangeExecutableLocation}
          onClearExecutablePath={onClearExecutablePath}
          onOpenSaveFolder={onOpenSaveFolder}
        />
      )}

      <ShortcutSection
        isCustomGame={isCustomGame}
        shouldShowCreateStartMenuShortcut={shouldShowCreateStartMenuShortcut}
        creatingSteamShortcut={creatingSteamShortcut}
        steamShortcutExists={steamShortcutExists}
        onCreateShortcut={onCreateShortcut}
        onCreateSteamShortcut={onCreateSteamShortcut}
        onDeleteSteamShortcut={onDeleteSteamShortcut}
      />

      <LaunchOptionsSection
        launchOptions={launchOptions}
        onChangeLaunchOptions={onChangeLaunchOptions}
        onBlurLaunchOptions={onBlurLaunchOptions}
        onClearLaunchOptions={onClearLaunchOptions}
      />
    </VerticalFocusGroup>
  );
}
