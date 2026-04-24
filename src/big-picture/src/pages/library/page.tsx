import { useEffect, useMemo } from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks";
import { LibraryHero } from "../../components";

import "./page.scss";

const LAST_PLAYED_GAMES_COUNT = 3;

export default function LibraryPage() {
  const { library, updateLibrary } = useLibrary();

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

  const sortedLibrary = useMemo(() => {
    return [...library].sort((a, b) => {
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }, [library]);

  const filteredLibrary = useMemo(() => {
    return sortedLibrary;
  }, [sortedLibrary]);

  const lastPlayedGames = useMemo(() => {
    return [...filteredLibrary]
      .filter((game) => game.lastTimePlayed != null)
      .sort((a, b) => {
        const aLastPlayed = new Date(a.lastTimePlayed as Date).getTime();
        const bLastPlayed = new Date(b.lastTimePlayed as Date).getTime();

        return bLastPlayed - aLastPlayed;
      })
      .slice(0, LAST_PLAYED_GAMES_COUNT);
  }, [filteredLibrary]);

  if (library.length === 0 && lastPlayedGames.length === 0) {
    return (
      <div className="library-page__empty">
        <p>No games in library</p>
      </div>
    );
  }

  return (
    <section className="library-page">
      <LibraryHero lastPlayedGames={lastPlayedGames} />
    </section>
  );
}
