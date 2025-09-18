import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import { useLibrary } from "@renderer/hooks";
import { useGameFolders } from "@renderer/hooks/use-game-folders";
import type { LibraryGame } from "@types";

export interface CreateGamesFolderProps {
  visible: boolean;
  onClose: () => void;
}

export function CreateGamesFolder({
  visible,
  onClose,
}: CreateGamesFolderProps) {
  const { t } = useTranslation("games_folder");
  const { library } = useLibrary();
  const { createFolder } = useGameFolders();

  const [folderName, setFolderName] = useState("");
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  const handleGameToggle = (gameId: string) => {
    const newSelected = new Set(selectedGames);
    if (newSelected.has(gameId)) {
      newSelected.delete(gameId);
    } else {
      newSelected.add(gameId);
    }
    setSelectedGames(newSelected);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim() || selectedGames.size === 0) return;

    setIsCreating(true);
    try {
      // Criar pasta virtual com os jogos selecionados
      createFolder({
        name: folderName.trim(),
        gameIds: Array.from(selectedGames),
        color: "#3b82f6", // Cor padrão azul
      });

      // Reset form
      setFolderName("");
      setSelectedGames(new Set());
      onClose();
    } catch (error) {
      console.error("Erro ao criar pasta virtual:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setFolderName("");
    setSelectedGames(new Set());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("create_games_folder")}
      onClose={handleClose}
      large
    >
      <div style={{ padding: "20px" }}>
        <div style={{ marginBottom: "20px" }}>
          <TextField
            label={t("folder_name")}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={t("folder_name_placeholder")}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h3>{t("select_games")}</h3>
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "4px",
              padding: "10px",
            }}
          >
            {library.map((game: LibraryGame) => (
              <div
                key={game.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px",
                  cursor: "pointer",
                  borderRadius: "4px",
                  marginBottom: "4px",
                }}
                onClick={() => handleGameToggle(game.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedGames.has(game.id)}
                  onChange={() => handleGameToggle(game.id)}
                  style={{ marginRight: "10px" }}
                />
                <img
                  src={game.iconUrl || "/default-game-icon.png"}
                  alt={game.title}
                  style={{
                    width: "32px",
                    height: "32px",
                    marginRight: "10px",
                    borderRadius: "4px",
                  }}
                />
                <span style={{ flex: 1 }}>{game.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}
        >
          <Button onClick={handleClose} theme="outline" disabled={isCreating}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleCreateFolder}
            disabled={
              !folderName.trim() || selectedGames.size === 0 || isCreating
            }
          >
            {isCreating ? t("creating") : t("create_folder")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
