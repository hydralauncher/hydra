import { useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SearchIcon, CheckIcon, XIcon } from "@primer/octicons-react";
import { LibraryGame } from "@types";
import { Button } from "@renderer/components";
import { HomeGroup } from "@renderer/hooks/use-home-groups";
import { FolderPickerCard } from "./folder-picker-card";
import "./folder-game-picker.scss";

interface FolderGamePickerProps {
  folder: HomeGroup;
  library: LibraryGame[];
  onConfirm: (gameIds: string[]) => void;
  onCancel: () => void;
}

export function FolderGamePicker({
  folder,
  library,
  onConfirm,
  onCancel,
}: Readonly<FolderGamePickerProps>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(folder.gameIds)
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const filteredGames = useMemo(() => {
    let games = library;
    if (showSelectedOnly) {
      games = games.filter((g) => selectedIds.has(g.objectId));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      games = games.filter((g) => g.title.toLowerCase().includes(q));
    }
    return games;
  }, [library, selectedIds, searchQuery, showSelectedOnly]);

  const handleToggle = useCallback((game: LibraryGame) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(game.objectId)) {
        next.delete(game.objectId);
      } else {
        next.add(game.objectId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const visibleIds = filteredGames.map((g) => g.objectId);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [filteredGames, selectedIds]);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selectedIds));
  }, [onConfirm, selectedIds]);

  const allVisible = filteredGames.every((g) => selectedIds.has(g.objectId));

  return (
    <AnimatePresence>
      <motion.div
        className="folder-game-picker"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
      >
        <header className="folder-game-picker__header">
          <button
            type="button"
            className="folder-game-picker__cancel-btn"
            onClick={onCancel}
            aria-label="Cancelar"
          >
            <XIcon size={16} />
            Cancelar
          </button>

          <span className="folder-game-picker__title">
            Adicionar jogos em&nbsp;<strong>{folder.name}</strong>
          </span>

          <div className="folder-game-picker__header-actions">
            <span className="folder-game-picker__count">
              {selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}
            </span>
            <Button theme="primary" onClick={handleConfirm}>
              <CheckIcon size={14} />
              Salvar
            </Button>
          </div>
        </header>

        <div className="folder-game-picker__toolbar">
          <div className="folder-game-picker__search">
            <SearchIcon size={14} className="folder-game-picker__search-icon" />
            <input
              type="text"
              className="folder-game-picker__search-input"
              placeholder="Buscar jogo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Buscar jogo"
            />
          </div>

          <button
            type="button"
            className={`folder-game-picker__filter-btn${showSelectedOnly ? " folder-game-picker__filter-btn--active" : ""}`}
            onClick={() => setShowSelectedOnly((p) => !p)}
          >
            Selecionados
          </button>

          <button
            type="button"
            className={`folder-game-picker__filter-btn${allVisible && filteredGames.length > 0 ? " folder-game-picker__filter-btn--active" : ""}`}
            onClick={handleSelectAll}
          >
            Selecionar todos
          </button>
        </div>

        <div className="folder-game-picker__grid">
          {filteredGames.map((game) => (
            <FolderPickerCard
              key={`${game.shop}-${game.objectId}`}
              game={game}
              isSelected={selectedIds.has(game.objectId)}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
