import type { LibraryGame } from "@types";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks";
import {
  type LibraryViewMode,
  LibraryFocusGrid,
  LibraryFilters,
  LibraryFocusList,
  GameSettingsModal,
  LibraryHero,
  VerticalFocusGroup,
  LIBRARY_VIEW_MODE_STORAGE_KEY,
  isLibraryViewMode,
  type LibraryFilterTab,
  useLibraryFavorite,
  useLibraryPageData,
} from "../../components";

import "./page.scss";

function getInitialLibraryViewMode(): LibraryViewMode {
  if (typeof globalThis.window === "undefined") {
    return "grid";
  }

  try {
    const storedValue = globalThis.window.localStorage.getItem(
      LIBRARY_VIEW_MODE_STORAGE_KEY
    );

    return isLibraryViewMode(storedValue) ? storedValue : "grid";
  } catch {
    return "grid";
  }
}

export default function LibraryPage() {
  const { library, updateLibrary } = useLibrary();
  const [selectedFilterTab, setSelectedFilterTab] =
    useState<LibraryFilterTab>("all");
  const [viewMode, setViewMode] = useState<LibraryViewMode>(
    getInitialLibraryViewMode
  );
  const [search, setSearch] = useState("");
  const [settingsGame, setSettingsGame] = useState<LibraryGame | null>(null);
  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);
  const {
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    firstListItemId,
    lastPlayedGames,
  } = useLibraryPageData(library, selectedFilterTab, search);
  const firstContentItemId =
    viewMode === "list" ? firstListItemId : firstGridItemId;
  const contentTransitionKey = `${selectedFilterTab}:${viewMode}`;

  useEffect(() => {
    updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribe = globalThis.window.electron.onLibraryBatchComplete(
      () => {
        updateLibrary();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [updateLibrary]);

  useEffect(() => {
    try {
      globalThis.window.localStorage.setItem(
        LIBRARY_VIEW_MODE_STORAGE_KEY,
        viewMode
      );
    } catch {
      // Ignore storage failures and keep the in-memory view mode.
    }
  }, [viewMode]);

  if (library.length === 0 && lastPlayedGames.length === 0) {
    return (
      <div className="library-page__empty">
        <p>No games in library</p>
      </div>
    );
  }

  return (
    <section className="library-page">
      <VerticalFocusGroup>
        <LibraryHero
          lastPlayedGames={lastPlayedGames}
          onOpenGameSettings={(game) => {
            console.log("Library hero options clicked", game);
          }}
          onToggleFavorite={toggleFavorite}
          favoriteLoadingGameId={favoriteLoadingGameId}
        />

        <LibraryFilters
          selectedTab={selectedFilterTab}
          onSelectedTabChange={setSelectedFilterTab}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          search={search}
          onSearchChange={setSearch}
          counts={filterCounts}
          firstContentItemId={firstContentItemId}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={contentTransitionKey}
            layout
            className="library-page__content-transition"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{
              opacity: { duration: 0.18, ease: "easeOut" },
              y: { duration: 0.18, ease: "easeOut" },
              layout: { duration: 0.22, ease: "easeOut" },
            }}
          >
            {viewMode === "list" ? (
              <LibraryFocusList games={filteredLibrary} />
            ) : (
              <LibraryFocusGrid games={filteredLibrary} />
            )}
          </motion.div>
        </AnimatePresence>
      </VerticalFocusGroup>

      <GameSettingsModal
        visible={settingsGame !== null}
        game={settingsGame}
        onClose={() => setSettingsGame(null)}
        onGameUpdated={(updatedGame) => {
          setSettingsGame(updatedGame);
          updateLibrary();
        }}
      />
    </section>
  );
}
