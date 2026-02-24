import { Trans, useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { LibraryGame, ShortcutLocation } from "@types";
import { FileIcon } from "@primer/octicons-react";

interface GeneralSettingsSectionProps {
  game: LibraryGame;
  gameTitle: string;
  launchOptions: string;
  updatingGameTitle: boolean;
  creatingSteamShortcut: boolean;
  shouldShowCreateStartMenuShortcut: boolean;
  shouldShowWinePrefixConfiguration: boolean;
  loadingSaveFolder: boolean;
  saveFolderPath: string | null;
  steamShortcutExists: boolean;
  onChangeExecutableLocation: () => Promise<void>;
  onClearExecutablePath: () => Promise<void>;
  onOpenGameExecutablePath: () => Promise<void>;
  onOpenSaveFolder: () => Promise<void>;
  onCreateShortcut: (location: ShortcutLocation) => Promise<void>;
  onCreateSteamShortcut: () => void;
  onDeleteSteamShortcut: () => Promise<void>;
  onChangeGameTitle: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
  onChangeLaunchOptions: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearLaunchOptions: () => Promise<void>;
}

export function GeneralSettingsSection({
  game,
  gameTitle,
  launchOptions,
  updatingGameTitle,
  creatingSteamShortcut,
  shouldShowCreateStartMenuShortcut,
  shouldShowWinePrefixConfiguration,
  loadingSaveFolder,
  saveFolderPath,
  steamShortcutExists,
  onChangeExecutableLocation,
  onClearExecutablePath,
  onOpenGameExecutablePath,
  onOpenSaveFolder,
  onCreateShortcut,
  onCreateSteamShortcut,
  onDeleteSteamShortcut,
  onChangeGameTitle,
  onBlurGameTitle,
  onChangeLaunchOptions,
  onClearLaunchOptions,
}: Readonly<GeneralSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  return (
    <>
      <div className="game-options-modal__section">
        <TextField
          label={t("edit_game_modal_title")}
          placeholder={t("edit_game_modal_enter_title")}
          value={gameTitle}
          onChange={onChangeGameTitle}
          onBlur={() => void onBlurGameTitle()}
          theme="dark"
          disabled={updatingGameTitle}
        />
      </div>

      <div className="game-options-modal__section">
        <div className="game-options-modal__header">
          <h2>{t("executable_section_title")}</h2>
          <h4 className="game-options-modal__header-description">
            {t("executable_section_description")}
          </h4>
        </div>

        <div className="game-options-modal__executable-field">
          <TextField
            value={game.executablePath || ""}
            readOnly
            theme="dark"
            disabled
            placeholder={t("no_executable_selected")}
            rightContent={
              <>
                <Button
                  type="button"
                  theme="outline"
                  onClick={onChangeExecutableLocation}
                >
                  <FileIcon />
                  {t("select_executable")}
                </Button>
                {game.executablePath && (
                  <Button onClick={onClearExecutablePath} theme="outline">
                    {t("clear")}
                  </Button>
                )}
              </>
            }
          />

          <div className="game-options-modal__executable-field-buttons">
            {game.executablePath && (
              <Button
                type="button"
                theme="outline"
                onClick={onOpenGameExecutablePath}
              >
                {t("open_folder")}
              </Button>
            )}
            {game.shop !== "custom" && window.electron.platform === "win32" && (
              <Button
                type="button"
                theme="outline"
                onClick={onOpenSaveFolder}
                disabled={loadingSaveFolder || !saveFolderPath}
              >
                {loadingSaveFolder
                  ? t("searching_save_folder")
                  : saveFolderPath
                    ? t("open_save_folder")
                    : t("no_save_folder_found")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {game.executablePath && (
        <div className="game-options-modal__section">
          <div className="game-options-modal__header">
            <h2>{t("shortcuts_section_title")}</h2>
            <h4 className="game-options-modal__header-description">
              {t("shortcuts_section_description")}
            </h4>
          </div>

          <div className="game-options-modal__row">
            <Button onClick={() => onCreateShortcut("desktop")} theme="outline">
              {t("create_shortcut")}
            </Button>
            {game.shop !== "custom" &&
              (steamShortcutExists ? (
                <Button
                  onClick={onDeleteSteamShortcut}
                  theme="danger"
                  disabled={creatingSteamShortcut}
                >
                  <SteamLogo />
                  {t("delete_steam_shortcut")}
                </Button>
              ) : (
                <Button
                  onClick={onCreateSteamShortcut}
                  theme="outline"
                  disabled={creatingSteamShortcut}
                >
                  <SteamLogo />
                  {t("create_steam_shortcut")}
                </Button>
              ))}
            {shouldShowCreateStartMenuShortcut && (
              <Button
                onClick={() => onCreateShortcut("start_menu")}
                theme="outline"
              >
                {t("create_start_menu_shortcut")}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="game-options-modal__launch-options">
        <div className="game-options-modal__header">
          <h2>{t("launch_options")}</h2>
          <h4 className="game-options-modal__header-description">
            {shouldShowWinePrefixConfiguration ? (
              <Trans
                i18nKey="launch_options_description_linux"
                ns="game_details"
                defaults="Add game launch arguments, or use <code>%command%</code> to wrap the launch command."
                components={{
                  code: <code className="game-options-modal__inline-code" />,
                }}
              />
            ) : (
              t("launch_options_description")
            )}
          </h4>
        </div>

        <TextField
          value={launchOptions}
          theme="dark"
          placeholder={t("launch_options_placeholder")}
          onChange={onChangeLaunchOptions}
          rightContent={
            game.launchOptions && (
              <Button onClick={onClearLaunchOptions} theme="outline">
                {t("clear")}
              </Button>
            )
          }
        />
      </div>
    </>
  );
}
