import type { LibraryGame } from "@types";
import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks";
import {
  LibraryFocusGrid,
  LibraryFilters,
  GameSettingsModal,
  LibraryHero,
  VerticalFocusGroup,
  type LibraryFilterTab,
  useLibraryFavorite,
  useLibraryPageData,
} from "../../components";

import "./page.scss";

export default function LibraryPage() {
  const { library, updateLibrary } = useLibrary();
  const [selectedFilterTab, setSelectedFilterTab] =
    useState<LibraryFilterTab>("all");
  const [search, setSearch] = useState("");
  const [settingsGame, setSettingsGame] = useState<LibraryGame | null>(null);
  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);
  const { filteredLibrary, filterCounts, firstGridItemId, lastPlayedGames } =
    useLibraryPageData(library, selectedFilterTab, search);

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
          search={search}
          onSearchChange={setSearch}
          counts={filterCounts}
          firstGridItemId={firstGridItemId}
        />

        <LibraryFocusGrid games={filteredLibrary} />
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
