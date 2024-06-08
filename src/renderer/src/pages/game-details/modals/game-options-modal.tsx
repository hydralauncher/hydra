import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { Game } from "@types";
import * as styles from "./game-options-modal.css";
import { gameDetailsContext } from "../game-details.context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import { useDownload } from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";

export interface GameOptionsModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
  selectGameExecutable: () => Promise<string | null>;
}

export function GameOptionsModal({
  visible,
  game,
  onClose,
  selectGameExecutable,
}: GameOptionsModalProps) {
  const { t } = useTranslation("game_details");

  const { updateGame, openRepacksModal } = useContext(gameDetailsContext);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);

  const {
    removeGameInstaller,
    removeGameFromLibrary,
    isGameDeleting,
    cancelDownload,
  } = useDownload();

  const deleting = game ? isGameDeleting(game?.id) : false;

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.status === "active" && lastPacket?.game.id === game?.id;

  const handleRemoveGameFromLibrary = async () => {
    if (isGameDownloading) {
      await cancelDownload(game.id);
    }

    await removeGameFromLibrary(game.id);
    updateGame();
    onClose();
  };

  const handleChangeExecutableLocation = async () => {
    const path = await selectGameExecutable();

    if (path) {
      await window.electron.updateExecutablePath(game.id, path);
      updateGame();
    }
  };

  const handleCreateShortcut = async () => {
    await window.electron.createGameShortcut(game.id);
  };

  const handleOpenDownloadFolder = async () => {
    await window.electron.openGameInstallerPath(game.id);
  };

  const handleDeleteGame = async () => {
    await removeGameInstaller(game.id);
    updateGame();
  };

  const handleOpenGameExecutablePath = async () => {
    await window.electron.openGameExecutablePath(game.id);
  };

  return (
    <>
      <Modal
        visible={visible}
        title={game.title}
        onClose={onClose}
        large={true}
      >
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

        <div className={styles.optionsContainer}>
          <div className={styles.gameOptionHeader}>
            <h2>{t("executable_section_title")}</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              {t("executable_section_description")}
            </h4>
          </div>
          <div className={styles.gameOptionRow}>
            <TextField
              value={game.executablePath || ""}
              readOnly
              theme="dark"
              disabled
              placeholder={t("no_executable_selected")}
            />
            <Button
              type="button"
              theme="outline"
              onClick={handleChangeExecutableLocation}
            >
              {t("select_executable")}
            </Button>
          </div>

          {game.executablePath && (
            <div className={styles.gameOptionRow}>
              <Button
                type="button"
                theme="outline"
                onClick={handleOpenGameExecutablePath}
                disabled={!game.executablePath}
              >
                {t("open_folder")}
              </Button>
              <Button
                onClick={handleCreateShortcut}
                theme="outline"
                disabled={deleting || !game.executablePath}
              >
                {t("create_shortcut")}
              </Button>
            </div>
          )}

          <div className={styles.gameOptionHeader}>
            <h2>{t("downloads_secion_title")}</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              {t("downloads_section_description")}
            </h4>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={openRepacksModal}
              theme="outline"
              disabled={deleting || isGameDownloading}
            >
              {t("open_download_options")}
            </Button>
            {game.downloadPath && (
              <Button
                onClick={handleOpenDownloadFolder}
                theme="outline"
                disabled={deleting || !game.downloadPath}
              >
                {t("open_download_location")}
              </Button>
            )}
          </div>
          <div className={styles.gameOptionHeader}>
            <h2>{t("danger_zone_section_title")}</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              {t("danger_zone_section_description")}
            </h4>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={() => setShowRemoveGameModal(true)}
              theme="danger"
              disabled={deleting}
            >
              {t("remove_from_library")}
            </Button>
            <Button
              onClick={() => {
                setShowDeleteModal(true);
              }}
              theme="danger"
              disabled={isGameDownloading || deleting || !game.downloadPath}
            >
              {t("remove_files")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
