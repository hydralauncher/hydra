import { useEffect, useMemo } from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks";
import "./page.scss";
import { GameCard } from "../../components";

export default function LibraryPage() {
  const { library, updateLibrary } = useLibrary();

  useEffect(() => {
    void updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      void updateLibrary();
    });

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

  if (library.length === 0) {
    return (
      <div className="library-page__empty">
        <p>No games in library</p>
      </div>
    );
  }

  return (
    <section className="library-page">
      <div className="library-page__toolbar">
        <h1 className="library-page__toolbar__title">Library</h1>
      </div>
      <div className="library-page__grid">
        {filteredLibrary.map((game) => (
          <GameCard
            key={game.objectId}
            coverImageUrl={game.coverImageUrl}
            gameTitle={game.title}
          />
        ))}
      </div>
    </section>
  );
}
