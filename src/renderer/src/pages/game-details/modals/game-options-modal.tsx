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
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);

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

  const handleDeleteGame = async () => {
    await removeGameInstaller(game.id);
  };

  const handleOpenGameInstallerPath = async () => {
    await window.electron.openGameInstallerPath(game.id);
  };

  const handleOpenGameExecutablePath = async () => {
    await window.electron.openGameExecutablePath(game.id);
  };

  return (
    <>
      <Modal visible={visible} title={game.title} onClose={onClose}>
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
            minWidth: "500px",
          }}
        >
          <div style={{ marginBottom: `${SPACING_UNIT * 2}px` }}>
            <Button
              key={"general"}
              theme={currentCategoryIndex === 0 ? "primary" : "outline"}
              onClick={() => setCurrentCategoryIndex(0)}
            >
              General
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
              onClick={handleOpenGameExecutablePath}
            >
              <FileDirectoryOpenFillIcon />
              {"Abrir local do executável"}
            </Button>

            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleChangeExecutableLocation}
            >
              <FileSymlinkFileIcon />
              {"Alterar"}
            </Button>
          </div>

          <div className={styles.downloadSourceField}>
            <TextField
              label="Caminho do instalador"
              value={game.downloadPath + game.folderName}
              readOnly
              theme="dark"
              disabled
              placeholder=""
            />
          </div>

          <div className={styles.downloadSourceField}>
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={handleOpenGameInstallerPath}
            >
              <FileDirectoryOpenFillIcon />
              {"Abrir pasta do instalador"}
            </Button>
            <Button
              type="button"
              theme="outline"
              style={{ alignSelf: "flex-end" }}
              onClick={() => {
                setShowDeleteModal(true);
              }}
            >
              <TrashIcon />
              {"Remover instalador"}
            </Button>
            <Button
              onClick={openRepacksModal}
              theme="outline"
              disabled={deleting}
            >
              {t("open_download_options")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
