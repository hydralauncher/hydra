import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { Game } from "@types";

import * as styles from "./game-options-modal.css";

import { SPACING_UNIT } from "../../../theme.css";
import { gameDetailsContext } from "../game-details.context";
import {
  FileDirectoryOpenFillIcon,
  FileSymlinkFileIcon,
  PencilIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import { useDownload } from "@renderer/hooks";

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
  const { updateGame, openRepacksModal } = useContext(gameDetailsContext);

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { removeGameInstaller, isGameDeleting } = useDownload();

  const deleting = game ? isGameDeleting(game?.id) : false;

  const { t } = useTranslation("game_details");

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

  const handleDeleteGame = async () => {
    await removeGameInstaller(game.id);
    updateGame();
  };

  const handleOpenGameInstallerPath = async () => {
    await window.electron.openGameInstallerPath(game.id);
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
            width: "100%",
          }}
        >
          <div className={styles.downloadSourceField}>
            <Button
              onClick={openRepacksModal}
              theme="outline"
              disabled={deleting}
            >
              {t("open_download_options")}
            </Button>
          </div>
          <div className={styles.downloadSourceField}>
            <TextField
              label="Caminho do executável"
              value={game.executablePath || ""}
              readOnly
              theme="dark"
              disabled
              placeholder="Selecione um executável"
            />
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleChangeExecutableLocation}
              title={
                game.executablePath
                  ? "Trocar executável"
                  : "Selecionar executável"
              }
            >
              <PencilIcon />
            </Button>
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleOpenGameExecutablePath}
              disabled={!game.executablePath}
              title={"Abrir pasta"}
            >
              <FileDirectoryOpenFillIcon />
            </Button>

            <Button
              onClick={handleCreateShortcut}
              style={{ alignSelf: "flex-end" }}
              theme="outline"
              disabled={deleting || !game.executablePath}
              title={"Criar atalho"}
            >
              <FileSymlinkFileIcon />
            </Button>
          </div>

          <div className={styles.downloadSourceField}></div>

          {game.folderName && (
            <div className={styles.downloadSourceField}>
              <TextField
                label="Caminho do instalador"
                value={`${game.downloadPath}\\${game.folderName}`}
                readOnly
                theme="dark"
                disabled
                placeholder=""
              />

              <Button
                type="button"
                theme="outline"
                style={{ alignSelf: "flex-end" }}
                onClick={handleOpenGameInstallerPath}
                disabled={!game.downloadPath}
                title={"Abrir pasta"}
              >
                <FileDirectoryOpenFillIcon />
              </Button>
              <Button
                type="button"
                theme="outline"
                style={{ alignSelf: "flex-end" }}
                disabled={!game.downloadPath}
                onClick={() => {
                  setShowDeleteModal(true);
                }}
                title={"Remover instalador"}
              >
                <TrashIcon />
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
