import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { Game } from "@types";
import * as styles from "./game-options-modal.css";
import { gameDetailsContext } from "@renderer/context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import { useDownload, useToast } from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";
import { CollectionsModal } from "./collections-modal";

export interface GameOptionsModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
}

export function GameOptionsModal({
  visible,
  game,
  onClose,
}: GameOptionsModalProps) {
  const { t } = useTranslation(["game_details", "collections"]);

  const { showSuccessToast, showErrorToast } = useToast();

  const { updateGame, setShowRepacksModal, repacks, selectGameExecutable } =
    useContext(gameDetailsContext);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);

  const {
    removeGameInstaller,
    removeGameFromLibrary,
    isGameDeleting,
    cancelDownload,
  } = useDownload();

  const deleting = isGameDeleting(game.id);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game.status === "active" && lastPacket?.game.id === game.id;

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
    window.electron.createGameShortcut(game.id).then((success) => {
      if (success) {
        showSuccessToast(t("create_shortcut_success"));
      } else {
        showErrorToast(t("create_shortcut_error"));
      }
    });
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

      <Modal
        visible={visible}
        title={game.title}
        onClose={onClose}
        large={true}
      >
        <div className={styles.optionsContainer}>
          <div className={styles.gameOptionHeader}>
            <h2>{t("collections:collections")}</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              {t("collections:add_the_game_to_the_collection")}
            </h4>
          </div>

          <Button
            type="button"
            theme="outline"
            onClick={() => setShowCollectionsModal(true)}
          >
            {t("collections:select_a_collection")}
          </Button>

          <CollectionsModal
            visible={showCollectionsModal}
            game={game}
            onClose={() => {
              setShowCollectionsModal(false);
            }}
          />

          <div className={styles.gameOptionHeader}>
            <h2>{t("executable_section_title")}</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              {t("executable_section_description")}
            </h4>
          </div>

          <TextField
            value={game.executablePath || ""}
            readOnly
            theme="dark"
            disabled
            placeholder={t("no_executable_selected")}
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleChangeExecutableLocation}
              >
                {t("select_executable")}
              </Button>
            }
          />

          {game.executablePath && (
            <div className={styles.gameOptionRow}>
              <Button
                type="button"
                theme="outline"
                onClick={handleOpenGameExecutablePath}
              >
                {t("open_folder")}
              </Button>
              <Button onClick={handleCreateShortcut} theme="outline">
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
              onClick={() => setShowRepacksModal(true)}
              theme="outline"
              disabled={deleting || isGameDownloading || !repacks.length}
            >
              {t("open_download_options")}
            </Button>
            {game.downloadPath && (
              <Button
                onClick={handleOpenDownloadFolder}
                theme="outline"
                disabled={deleting}
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
