import { useMemo } from "react";
import { FocusItem, GameCard, GridFocusGroup } from "../../components";
import { useLibrary } from "../../hooks";
import "./page.scss";

export default function LibraryPage() {
  const { library } = useLibrary();

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

      <GridFocusGroup className="library-page__grid">
        {filteredLibrary.map((game) => (
          <FocusItem id={game.objectId} key={game.objectId}>
            <GameCard
              coverImageUrl={game.coverImageUrl}
              gameTitle={game.title}
            />
          </FocusItem>
        ))}
      </GridFocusGroup>
    </section>
  );
}
