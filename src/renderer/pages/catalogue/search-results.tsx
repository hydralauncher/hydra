import { GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import type { CatalogueEntry } from "@types";

import type { DebouncedFunc } from "lodash";
import debounce from "lodash/debounce";

import { clearSearch } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { vars } from "@renderer/theme.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as styles from "./catalogue.css";

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
