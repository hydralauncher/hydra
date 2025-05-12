import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import type { LibraryGame, ShortcutLocation } from "@types";
import { gameDetailsContext } from "@renderer/context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import { useDownload, useToast, useUserDetails } from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";
import { ResetAchievementsModal } from "./reset-achievements-modal";
import { FileDirectoryIcon, FileIcon } from "@primer/octicons-react";
import { debounce } from "lodash-es";
import "./game-options-modal.scss";

export interface GameOptionsModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
}

export function GameOptionsModal({
  visible,
  game,
  onClose,
}: Readonly<GameOptionsModalProps>) {
  const { t } = useTranslation("game_details");

  const { showSuccessToast, showErrorToast } = useToast();

  const {
    updateGame,
    setShowRepacksModal,
    repacks,
    selectGameExecutable,
    achievements,
  } = useContext(gameDetailsContext);

  const { hasActiveSubscription } = useUserDetails();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);
  const [launchOptions, setLaunchOptions] = useState(game.launchOptions ?? "");
  const [showResetAchievementsModal, setShowResetAchievementsModal] =
    useState(false);
  const [isDeletingAchievements, setIsDeletingAchievements] = useState(false);
  const [automaticCloudSync, setAutomaticCloudSync] = useState(
    game.automaticCloudSync ?? false
  );

  const {
    removeGameInstaller,
    removeGameFromLibrary,
    isGameDeleting,
    cancelDownload,
  } = useDownload();

  const { userDetails } = useUserDetails();

  const hasAchievements =
    (achievements?.filter((achievement) => achievement.unlocked).length ?? 0) >
    0;

  const deleting = isGameDeleting(game.id);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game.download?.status === "active" && lastPacket?.gameId === game.id;

  const debounceUpdateLaunchOptions = useRef(
    debounce(async (value: string) => {
      await window.electron.updateLaunchOptions(
        game.shop,
        game.objectId,
        value
      );
      updateGame();
    }, 1000)
  ).current;

  const handleRemoveGameFromLibrary = async () => {
    if (isGameDownloading) {
      await cancelDownload(game.shop, game.objectId);
    }

    await removeGameFromLibrary(game.shop, game.objectId);
    updateGame();
    onClose();
  };

  const handleChangeExecutableLocation = async () => {
    const path = await selectGameExecutable();

    if (path) {
      const gameUsingPath =
        await window.electron.verifyExecutablePathInUse(path);

      if (gameUsingPath) {
        showErrorToast(
          t("executable_path_in_use", { game: gameUsingPath.title })
        );
        return;
      }

      window.electron
        .updateExecutablePath(game.shop, game.objectId, path)
        .then(updateGame);
    }
  };

  const handleCreateShortcut = async (location: ShortcutLocation) => {
    window.electron
      .createGameShortcut(game.shop, game.objectId, location)
      .then((success) => {
        if (success) {
          showSuccessToast(t("create_shortcut_success"));
        } else {
          showErrorToast(t("create_shortcut_error"));
        }
      })
      .catch(() => {
        showErrorToast(t("create_shortcut_error"));
      });
  };

  const handleOpenDownloadFolder = async () => {
    await window.electron.openGameInstallerPath(game.shop, game.objectId);
  };

  const handleDeleteGame = async () => {
    await removeGameInstaller(game.shop, game.objectId);
    updateGame();
  };

  const handleOpenGameExecutablePath = async () => {
    await window.electron.openGameExecutablePath(game.shop, game.objectId);
  };

  const handleClearExecutablePath = async () => {
    await window.electron.updateExecutablePath(game.shop, game.objectId, null);

    updateGame();
  };

  const handleChangeWinePrefixPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: await window.electron.getDefaultWinePrefixSelectionPath(),
    });

    if (filePaths && filePaths.length > 0) {
      try {
        await window.electron.selectGameWinePrefix(
          game.shop,
          game.objectId,
          filePaths[0]
        );
        await updateGame();
      } catch (error) {
        showErrorToast(
          t("invalid_wine_prefix_path"),
          t("invalid_wine_prefix_path_description")
        );
      }
    }
  };

  const handleClearWinePrefixPath = async () => {
    await window.electron.selectGameWinePrefix(game.shop, game.objectId, null);
    updateGame();
  };

  const handleChangeLaunchOptions = async (event) => {
    const value = event.target.value;

    setLaunchOptions(value);
    debounceUpdateLaunchOptions(value);
  };

  const handleClearLaunchOptions = async () => {
    setLaunchOptions("");

    window.electron
      .updateLaunchOptions(game.shop, game.objectId, null)
      .then(updateGame);
  };

  const shouldShowWinePrefixConfiguration =
    window.electron.platform === "linux";

  const shouldShowCreateStartMenuShortcut =
    window.electron.platform === "win32";

  const handleResetAchievements = async () => {
    setIsDeletingAchievements(true);
    try {
      await window.electron.resetGameAchievements(game.shop, game.objectId);
      await updateGame();
      showSuccessToast(t("reset_achievements_success"));
    } catch (error) {
      showErrorToast(t("reset_achievements_error"));
    } finally {
      setIsDeletingAchievements(false);
    }
  };

  const handleToggleAutomaticCloudSync = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setAutomaticCloudSync(event.target.checked);

    await window.electron.toggleAutomaticCloudSync(
      game.shop,
      game.objectId,
      event.target.checked
    );

    updateGame();
  };

  return (
    <>
      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      <RemoveGameFromLibraryModal
        visible={showRemoveGameModal}
        onClose={() => setShowRemoveGameModal(false)}
        removeGameFromLibrary={handleRemoveGameFromLibrary}
        game={game}
      />

      <ResetAchievementsModal
        visible={showResetAchievementsModal}
        onClose={() => setShowResetAchievementsModal(false)}
        resetAchievements={handleResetAchievements}
        game={game}
      />

      <Modal
        visible={visible}
        title={game.title}
        onClose={onClose}
        large={true}
      >
        <div className="game-options-modal__container">
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
                      onClick={handleChangeExecutableLocation}
                    >
                      <FileIcon />
                      {t("select_executable")}
                    </Button>
                    {game.executablePath && (
                      <Button
                        onClick={handleClearExecutablePath}
                        theme="outline"
                      >
                        {t("clear")}
                      </Button>
                    )}
                  </>
                }
              />

              {game.executablePath && (
                <div className="game-options-modal__executable-field-buttons">
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleOpenGameExecutablePath}
                  >
                    {t("open_folder")}
                  </Button>
                  <Button
                    onClick={() => handleCreateShortcut("desktop")}
                    theme="outline"
                  >
                    {t("create_shortcut")}
                  </Button>
                  {shouldShowCreateStartMenuShortcut && (
                    <Button
                      onClick={() => handleCreateShortcut("start_menu")}
                      theme="outline"
                    >
                      {t("create_start_menu_shortcut")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <CheckboxField
            label={
              <div className="game-options-modal__cloud-sync-label">
                {t("enable_automatic_cloud_sync")}
                <span className="game-options-modal__cloud-sync-hydra-cloud">
                  Hydra Cloud
                </span>
              </div>
            }
            checked={automaticCloudSync}
            disabled={!hasActiveSubscription || !game.executablePath}
            onChange={handleToggleAutomaticCloudSync}
          />

          {shouldShowWinePrefixConfiguration && (
            <div className="game-options-modal__wine-prefix">
              <div className="game-options-modal__header">
                <h2>{t("wine_prefix")}</h2>
                <h4 className="game-options-modal__header-description">
                  {t("wine_prefix_description")}
                </h4>
              </div>
              <TextField
                value={game.winePrefixPath || ""}
                readOnly
                theme="dark"
                disabled
                placeholder={t("no_directory_selected")}
                rightContent={
                  <>
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleChangeWinePrefixPath}
                    >
                      <FileDirectoryIcon />
                      {t("select_executable")}
                    </Button>
                    {game.winePrefixPath && (
                      <Button
                        onClick={handleClearWinePrefixPath}
                        theme="outline"
                      >
                        {t("clear")}
                      </Button>
                    )}
                  </>
                }
              />
            </div>
          )}

          <div className="game-options-modal__launch-options">
            <div className="game-options-modal__header">
              <h2>{t("launch_options")}</h2>
              <h4 className="game-options-modal__header-description">
                {t("launch_options_description")}
              </h4>
            </div>
            <TextField
              value={launchOptions}
              theme="dark"
              placeholder={t("launch_options_placeholder")}
              onChange={handleChangeLaunchOptions}
              rightContent={
                game.launchOptions && (
                  <Button onClick={handleClearLaunchOptions} theme="outline">
                    {t("clear")}
                  </Button>
                )
              }
            />
          </div>

          <div className="game-options-modal__downloads">
            <div className="game-options-modal__header">
              <h2>{t("downloads_section_title")}</h2>
              <h4 className="game-options-modal__header-description">
                {t("downloads_section_description")}
              </h4>
            </div>

            <div className="game-options-modal__row">
              <Button
                onClick={() => setShowRepacksModal(true)}
                theme="outline"
                disabled={deleting || isGameDownloading || !repacks.length}
              >
                {t("open_download_options")}
              </Button>
              {game.download?.downloadPath && (
                <Button
                  onClick={handleOpenDownloadFolder}
                  theme="outline"
                  disabled={deleting}
                >
                  {t("open_download_location")}
                </Button>
              )}
            </div>
          </div>

          <div className="game-options-modal__danger-zone">
            <div className="game-options-modal__header">
              <h2>{t("danger_zone_section_title")}</h2>
              <h4 className="game-options-modal__danger-zone-description">
                {t("danger_zone_section_description")}
              </h4>
            </div>

            <div className="game-options-modal__danger-zone-buttons">
              <Button
                onClick={() => setShowRemoveGameModal(true)}
                theme="danger"
                disabled={deleting}
              >
                {t("remove_from_library")}
              </Button>

              <Button
                onClick={() => setShowResetAchievementsModal(true)}
                theme="danger"
                disabled={
                  deleting ||
                  isDeletingAchievements ||
                  !hasAchievements ||
                  !userDetails
                }
              >
                {t("reset_achievements")}
              </Button>

              <Button
                onClick={() => {
                  setShowDeleteModal(true);
                }}
                theme="danger"
                disabled={
                  isGameDownloading || deleting || !game.download?.downloadPath
                }
              >
                {t("remove_files")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
