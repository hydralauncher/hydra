import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  getSkuRegion,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import type { LibraryGame, ShortcutLocation } from "@types";
import { Disc } from "@phosphor-icons/react";
import { HardDrive, Monitor, Trash } from "lucide-react";
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

const REGION_LABELS: Record<SkuRegion, string> = {
  US: "United States",
  EU: "Europe",
  JP: "Japan",
  KR: "Korea",
  ASIA: "Asia",
};

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
  const discs = game.discs ?? [];
  const selectedDisc =
    discs.find((disc) => disc.path === game.selectedDiscPath) ??
    discs[0] ??
    null;
  const showSaveFolderButton =
    game.shop !== "custom" && globalThis.window.electron.platform === "win32";

  return (
    <VerticalFocusGroup className="game-launch-settings-tab">
      {game.shop === "launchbox" ? (
        <SettingsSection
          className="game-launch-settings-tab__section"
          title={t("discs_section_title")}
          description={t("discs_section_description")}
        >
          <div className="game-launch-settings-tab__section-content">
            {discs.length > 0 && selectedDisc ? (
              <>
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
              </>
            ) : (
              <>
                <Typography className="game-launch-settings-tab__empty-state">
                  {t("no_discs_found")}
                </Typography>

                <Button
                  focusId={GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID}
                  variant="primary"
                  icon={<Disc size={20} />}
                  onClick={() => {
                    void onAddDiscFile();
                  }}
                >
                  {t("add_disc")}
                </Button>
              </>
            )}

            {discs.length > 0 ? (
              <HorizontalFocusGroup className="game-launch-settings-tab__actions game-launch-settings-tab__actions--thirds">
                <Button
                  focusId={GAME_LAUNCH_SETTINGS_ADD_DISC_FILE_ID}
                  variant="secondary"
                  icon={<Disc size={20} />}
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

            {discs.length > 0 ? (
              <Checkbox
                block
                focusId={GAME_LAUNCH_SETTINGS_DONT_ASK_DISC_ID}
                label={t("dont_ask_disc_again")}
                checked={Boolean(game.dontAskDiscSelection)}
                onChange={(checked) => {
                  void onToggleDontAskDiscSelection(checked);
                }}
              />
            ) : null}
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection
          className="game-launch-settings-tab__section"
          title={t("executable_section_title")}
          description={t("executable_section_description")}
        >
          <div className="game-launch-settings-tab__section-content">
            <div className="game-launch-settings-tab__exec-path-group">
              <FocusItem
                id={GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID}
                actions={{ primary: () => void onChangeExecutableLocation() }}
                asChild
              >
                <button
                  type="button"
                  className={`game-launch-settings-tab__exec-path-button${
                    game.executablePath
                      ? ""
                      : " game-launch-settings-tab__exec-path-button--placeholder"
                  }`}
                  onClick={() => void onChangeExecutableLocation()}
                >
                  {game.executablePath ?? t("no_executable_selected")}
                </button>
              </FocusItem>

              <HorizontalFocusGroup className="game-launch-settings-tab__actions">
                {game.executablePath ? (
                  <Button
                    variant="danger"
                    icon={<Trash size={16} />}
                    onClick={() => void onClearExecutablePath()}
                  >
                    Clear Path
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    icon={<FolderOpen size={16} />}
                    onClick={() => void onChangeExecutableLocation()}
                  >
                    Select Path
                  </Button>
                )}

                {showSaveFolderButton ? (
                  <Tooltip
                    content={
                      loadingSaveFolder
                        ? t("searching_save_folder")
                        : saveFolderPath
                          ? t("open_save_folder")
                          : t("no_save_folder_found")
                    }
                  >
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={t("open_save_folder")}
                      disabled={loadingSaveFolder || !saveFolderPath}
                      icon={<HardDrive size={16} />}
                      onClick={() => {
                        void onOpenSaveFolder();
                      }}
                    >
                      {null}
                    </Button>
                  </Tooltip>
                ) : null}
              </HorizontalFocusGroup>
            </div>
          </div>
        </SettingsSection>
      )}

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

            {game.shop !== "custom" ? (
              steamShortcutExists ? (
                <Button
                  focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_STEAM_ID}
                  variant="danger"
                  loading={creatingSteamShortcut}
                  icon={<SteamLogo />}
                  onClick={() => {
                    void onDeleteSteamShortcut();
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
                    void onCreateSteamShortcut();
                  }}
                >
                  {t("create_steam_shortcut")}
                </Button>
              )
            ) : null}

            {shouldShowCreateStartMenuShortcut ? (
              <Button
                focusId={GAME_LAUNCH_SETTINGS_SHORTCUT_START_MENU_ID}
                variant="secondary"
                onClick={() => {
                  void onCreateShortcut("start_menu");
                }}
              >
                {t("create_start_menu_shortcut")}
              </Button>
            ) : null}
          </HorizontalFocusGroup>
        </div>
      </SettingsSection>

      <SettingsSection
        className="game-launch-settings-tab__section"
        title={t("launch_options")}
        description={
          globalThis.window.electron.platform === "linux" ? (
            <Trans
              i18nKey="launch_options_description_linux"
              ns="game_details"
              defaults="Add game launch arguments, or use <code>%command%</code> to wrap the launch command."
              components={{
                code: (
                  <code className="game-launch-settings-tab__inline-code" />
                ),
              }}
            />
          ) : (
            t("launch_options_description")
          )
        }
      >
        <div className="game-launch-settings-tab__section-content">
          <div className="game-launch-settings-tab__launch-options-row">
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
                void onClearLaunchOptions();
              }}
            >
              Clear Args
            </Button>
          </div>
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
