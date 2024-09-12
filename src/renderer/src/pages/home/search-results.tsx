import { GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import type { CatalogueEntry } from "@types";

import type { DebouncedFunc } from "lodash";
import { debounce } from "lodash";

import { InboxIcon } from "@primer/octicons-react";
import { clearSearch } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as styles from "./home.css";
import { buildGameDetailsPath } from "@renderer/helpers";

import { vars } from "@renderer/theme.css";

export function SearchResults() {
  const dispatch = useAppDispatch();

  const { t } = useTranslation("home");
  const [searchParams] = useSearchParams();

  const [searchResults, setSearchResults] = useState<CatalogueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedFunc = useRef<DebouncedFunc<() => void> | null>(null);

  const navigate = useNavigate();

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(buildGameDetailsPath(game));
  };

  useEffect(() => {
    setIsLoading(true);
    if (debouncedFunc.current) debouncedFunc.current.cancel();

    debouncedFunc.current = debounce(() => {
      window.electron
        .searchGames(searchParams.get("query") ?? "")
        .then((results) => {
          setSearchResults(results);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 500);

    debouncedFunc.current();
  }, [searchParams, dispatch]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <section className={styles.cards}>
          {isLoading &&
            Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className={styles.cardSkeleton} />
            ))}

          {!isLoading && searchResults.length > 0 && (
            <>
              {searchResults.map((game) => (
                <GameCard
                  key={game.objectID}
                  game={game}
                  onClick={() => handleGameClick(game)}
                />
              ))}
            </>
          )}
        </section>

        {!isLoading && searchResults.length === 0 && (
          <div className={styles.noResults}>
            <InboxIcon size={56} />

            <p>{t("no_results")}</p>
          </div>
        )}
      </section>
    </SkeletonTheme>
  );
}
