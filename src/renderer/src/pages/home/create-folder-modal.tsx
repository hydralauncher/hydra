import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal, TextField, Button } from "@renderer/components";
import type { ShopAssets } from "@types";
import {
  CheckCircleFillIcon,
  SearchIcon,
  FilterIcon,
} from "@primer/octicons-react";

export interface CreateFolderModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, gameIds: string[]) => void;
  games: ShopAssets[];
  initialName?: string;
  initialSelectedIds?: string[];
}

export function CreateFolderModal({
  visible,
  onClose,
  onCreate,
  games,
  initialName = "",
  initialSelectedIds = [],
}: Readonly<CreateFolderModalProps>) {
  const { t } = useTranslation("home");
  const [name, setName] = useState(initialName);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setSelectedIds(initialSelectedIds);
    }
  }, [visible, initialName, initialSelectedIds]);

  const toggleGame = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    if (name.trim()) {
      onCreate(name.trim(), selectedIds);
      setName("");
      setSelectedIds([]);
      setSearchQuery("");
      setShowSelectedOnly(false);
      onClose();
    }
  };

  const filteredGames = games.filter((game) => {
    if (showSelectedOnly && !selectedIds.includes(game.objectId)) return false;
    if (searchQuery.trim()) {
      return game.title
        .toLowerCase()
        .includes(searchQuery.toLowerCase().trim());
    }
    return true;
  });

  return (
    <Modal
      visible={visible}
      title={
        initialName
          ? t("editar_pasta", { defaultValue: "Editar Pasta" })
          : t("criar_pasta", { defaultValue: "Criar Pasta" })
      }
      onClose={onClose}
      large
      className="create-folder-modal"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          height: "70vh",
          width: "100%",
        }}
      >
        {!initialName && (
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("nome_da_pasta", { defaultValue: "Nome da pasta" })}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <TextField
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("search_game", { defaultValue: "Buscar jogo..." })}
              rightContent={<SearchIcon size={16} />}
            />
          </div>
          <Button
            theme={showSelectedOnly ? "primary" : "outline"}
            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
            title="Mostrar selecionados"
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <FilterIcon size={16} />
              <span>{t("selected", { defaultValue: "Selecionados" })}</span>
            </div>
          </Button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingRight: 8,
          }}
        >
          {filteredGames.map((game) => (
            <div
              role="button"
              tabIndex={0}
              key={game.objectId}
              onClick={() => toggleGame(game.objectId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  toggleGame(game.objectId);
                }
              }}
              style={{
                display: "flex",
                flexShrink: 0,
                alignItems: "center",
                width: "100%",
                height: 100,
                minHeight: 100,
                borderRadius: 8,
                overflow: "hidden",
                border: selectedIds.includes(game.objectId)
                  ? "1px solid rgba(255, 255, 255, 0.4)"
                  : "1px solid rgba(255, 255, 255, 0.05)",
                background: selectedIds.includes(game.objectId)
                  ? "rgba(255, 255, 255, 0.08)"
                  : "rgba(255, 255, 255, 0.03)",
                cursor: "pointer",
                padding: 0,
                paddingRight: 16,
                transition: "all 0.2s ease",
              }}
            >
              <img
                src={
                  (game as any).coverImageUrl ||
                  (game.shop === "steam"
                    ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/header.jpg`
                    : "") ||
                  (game as any).customIconUrl ||
                  game.libraryImageUrl
                }
                alt={game.title}
                style={{
                  width: 156,
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center",
                  borderRadius: "8px 0 0 8px",
                  opacity: selectedIds.includes(game.objectId) ? 1 : 0.6,
                  maskImage:
                    "linear-gradient(to right, rgba(0,0,0,1) 70%, rgba(0,0,0,0))",
                  WebkitMaskImage:
                    "linear-gradient(to right, rgba(0,0,0,1) 80%, rgba(0,0,0,0))",
                }}
              />

              <span
                style={{
                  flex: 1,
                  paddingLeft: 16,
                  fontWeight: 600,
                  fontSize: 15,
                  color: selectedIds.includes(game.objectId)
                    ? "#fff"
                    : "rgba(255, 255, 255, 0.7)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {game.title}
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: selectedIds.includes(game.objectId)
                    ? "#5227ff"
                    : "rgba(255, 255, 255, 0.1)",
                  width: 24,
                  height: 24,
                }}
              >
                <CheckCircleFillIcon size={20} />
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: "auto",
          }}
        >
          <Button theme="outline" onClick={onClose}>
            {t("cancel", { defaultValue: "Cancelar" })}
          </Button>
          <Button theme="primary" disabled={!name.trim()} onClick={handleSave}>
            {t("save", { defaultValue: "Salvar" })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
