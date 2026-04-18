import type { LibraryGame } from "@types";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { IS_DESKTOP } from "../../constants";
import { useLibrary } from "../../hooks/use-library.hook";
import "./page.scss";

type SortOption =
  | "title_asc"
  | "title_desc"
  | "recently_played"
  | "most_played";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "title_asc", label: "A-Z" },
  { value: "title_desc", label: "Z-A" },
  { value: "recently_played", label: "Recently played" },
  { value: "most_played", label: "Most played" },
];

function GameCard({ game }: { game: LibraryGame }) {
  const coverUrl =
    game.coverImageUrl ?? game.libraryImageUrl ?? game.iconUrl ?? null;

  return (
    <div className="library-page__game-card">
      <div className="library-page__game-card__cover">
        {coverUrl ? (
          <img src={coverUrl} alt={game.title} draggable={false} />
        ) : (
          <div className="library-page__game-card__cover--placeholder" />
        )}
      </div>
      <span className="library-page__game-card__title">{game.title}</span>
    </div>
  );
}

export default function LibraryPage() {
  const { library, updateLibrary } = useLibrary();
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return (
      (localStorage.getItem("bp-library-sort") as SortOption) ?? "title_asc"
    );
  });
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

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

  const handleSortChange = useCallback((next: SortOption) => {
    setSortBy(next);
    localStorage.setItem("bp-library-sort", next);
  }, []);

  const sortedLibrary = useMemo(() => {
    return [...library].sort((a, b) => {
      switch (sortBy) {
        case "recently_played": {
          const aT = a.lastTimePlayed
            ? new Date(a.lastTimePlayed as Date).getTime()
            : 0;
          const bT = b.lastTimePlayed
            ? new Date(b.lastTimePlayed as Date).getTime()
            : 0;
          if (bT !== aT) return bT - aT;
          break;
        }
        case "most_played": {
          const diff = b.playTimeInMilliseconds - a.playTimeInMilliseconds;
          if (diff !== 0) return diff;
          break;
        }
        case "title_desc":
          return b.title.localeCompare(a.title, undefined, {
            sensitivity: "base",
          });
        default:
          break;
      }
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
  }, [library, sortBy]);

  const filteredLibrary = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    if (!q) return sortedLibrary;

    return sortedLibrary.filter((game) => {
      const title = game.title.toLowerCase();
      let qi = 0;
      for (let i = 0; i < title.length && qi < q.length; i++) {
        if (title[i] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }, [sortedLibrary, deferredSearch]);

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
        <input
          className="library-page__search"
          type="search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="library-page__sort-options">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`library-page__sort-btn${sortBy === opt.value ? " library-page__sort-btn--active" : ""}`}
              onClick={() => handleSortChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="library-page__grid">
        {filteredLibrary.map((game) => (
          <GameCard key={`${game.shop}-${game.objectId}`} game={game} />
        ))}
      </div>
    </section>
  );
}
