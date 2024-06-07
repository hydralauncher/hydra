import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { Game } from "@types";
import * as styles from "./game-options-modal.css";
import { gameDetailsContext } from "../game-details.context";
import { NoEntryIcon, TrashIcon } from "@primer/octicons-react";
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

  const { removeGameInstaller, removeGameFromLibrary, isGameDeleting } =
    useDownload();

  const deleting = game ? isGameDeleting(game?.id) : false;

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.status === "active" && lastPacket?.game.id === game?.id;

  const handleRemoveGameFromLibrary = async () => {
    await removeGameFromLibrary(game.id);
    updateGame();
    onClose();
  };

  const handleChangeExecutableLocation = async () => {
    const location = await selectGameExecutable();

    if (location) {
      await window.electron.updateExecutablePath(game.id, location);
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
          <div className={styles.gameOptionRow}>
            <Button
              onClick={openRepacksModal}
              theme="outline"
              disabled={deleting}
            >
              {t("open_download_options")}
            </Button>
            <Button
              onClick={handleOpenDownloadFolder}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting || !game.downloadPath}
            >
              {t("open_download_location")}
            </Button>
            <Button
              onClick={handleCreateShortcut}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting || !game.executablePath}
            >
              {t("create_shortcut")}
            </Button>
          </div>
          <div className={styles.gameOptionRow}>
            <TextField
              label="Caminho do executável"
              value={game.executablePath || ""}
              readOnly
              theme="dark"
              disabled
              placeholder={t("no_executable_selected")}
            />
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleChangeExecutableLocation}
            >
              {t("select_executable")}
            </Button>
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleOpenGameExecutablePath}
              disabled={!game.executablePath}
            >
              {t("open_folder")}
            </Button>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={() => {
                setShowDeleteModal(true);
              }}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={isGameDownloading || deleting || !game.downloadPath}
            >
              <TrashIcon />
              {t("remove_files")}
            </Button>

            <Button
              onClick={() => setShowRemoveGameModal(true)}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting}
            >
              <NoEntryIcon />
              {t("remove_from_library")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
