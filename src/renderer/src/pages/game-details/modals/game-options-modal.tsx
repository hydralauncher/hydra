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
          <div className={styles.gameOptionHeader}>
            <h2>Arquivos baixados</h2>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={handleOpenDownloadFolder}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting || !game.downloadPath}
            >
              {t("open_download_location")}
            </Button>
          </div>

          <div className={styles.gameOptionHeader}>
            <h2>Executável</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              O caminho do arquivo que sera executado ao clicar em "Jogar"
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
              onClick={handleCreateShortcut}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting || !game.executablePath}
            >
              {t("create_shortcut")}
            </Button>
          </div>
          <div className={styles.gameOptionHeader}>
            <h2>Downloads</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              Confira atualizações ou versões diferentes para este mesmo título
            </h4>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={openRepacksModal}
              theme="outline"
              disabled={deleting}
            >
              {t("open_download_options")}
            </Button>
          </div>
          <div className={styles.gameOptionHeader}>
            <h2>Zona de perigo</h2>
            <h4 className={styles.gameOptionHeaderDescription}>
              Remova o jogo da sua biblioteca ou os arquivos que foram baixados
              pelo Hydra
            </h4>
          </div>
          <div className={styles.gameOptionRow}>
            <Button
              onClick={() => setShowRemoveGameModal(true)}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting}
            >
              {t("remove_from_library")}
            </Button>
            <Button
              onClick={() => {
                setShowDeleteModal(true);
              }}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
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
