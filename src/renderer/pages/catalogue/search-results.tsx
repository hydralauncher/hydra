import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { GameCard } from "@renderer/components";

import type { CatalogueEntry } from "@types";

import debounce from "lodash/debounce";
import type { DebouncedFunc } from "lodash";

import * as styles from "./catalogue.css";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDispatch } from "@renderer/hooks";
import { clearSearch } from "@renderer/features";
import { vars } from "@renderer/theme.css";
import { useEffect, useRef, useState } from "react";

export function SearchResults() {
  const dispatch = useAppDispatch();

  const { query } = useParams();

  const [searchResults, setSearchResults] = useState<CatalogueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedFunc = useRef<DebouncedFunc<() => void | null>>(null);

  const navigate = useNavigate();

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(`/game/${game.shop}/${game.objectID}`);
  };

  useEffect(() => {
    setIsLoading(true);
    if (debouncedFunc.current) debouncedFunc.current.cancel();

    debouncedFunc.current = debounce(() => {
      window.electron
        .searchGames(query)
        .then((results) => {
          setSearchResults(results);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 300);

    debouncedFunc.current();
  }, [query, dispatch]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <section className={styles.cards({ searching: false })}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : searchResults.map((game) => (
                <GameCard
                  key={game.objectID}
                  game={game}
                  onClick={() => handleGameClick(game)}
                  disabled={!game.repacks.length}
                />
              ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
