import { Button, GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import type { CatalogueEntry } from "@types";

import type { DebouncedFunc } from "lodash";
import { debounce } from "lodash";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  InboxIcon,
} from "@primer/octicons-react";
import { clearSearch } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { vars } from "../../theme.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as styles from "./home.css";
import { buildGameDetailsPath } from "@renderer/helpers";

const PAGE_SIZE = 12;

export function SearchResults() {
  const dispatch = useAppDispatch();

  const { t } = useTranslation("home");
  const [searchParams] = useSearchParams();

  const [searchResults, setSearchResults] = useState<CatalogueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnd, setIsEnd] = useState(false);
  const debouncedFunc = useRef<DebouncedFunc<() => void> | null>(null);

  const navigate = useNavigate();
  const page = parseInt(searchParams.get("page") ?? "0");

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(buildGameDetailsPath(game));
  };

  useEffect(() => {
    setIsLoading(true);
    if (debouncedFunc.current) debouncedFunc.current.cancel();

    debouncedFunc.current = debounce(() => {
      window.electron
        .searchGames(searchParams.get("query") ?? "", {
          take: PAGE_SIZE,
          skip: PAGE_SIZE * page,
        })
        .then((results) => {
          setSearchResults(results);
          setIsEnd(results.length < PAGE_SIZE);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 300);

    debouncedFunc.current();
  }, [searchParams, page, dispatch]);

  const handleNextPage = () => {
    const params = new URLSearchParams(searchParams);
    params.set("page", (page + 1).toString());
    navigate(`/search?${params.toString()}`);
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.paginationContainer}>
        <Button
          onClick={() => navigate(-1)}
          theme="outline"
          disabled={page === 0 || isLoading}
        >
          <ArrowLeftIcon />
          {t("previous_page", { ns: "catalogue" })}
        </Button>

        <Button
          onClick={handleNextPage}
          theme="outline"
          disabled={isLoading || isEnd}
        >
          {t("next_page", { ns: "catalogue" })}
          <ArrowRightIcon />
        </Button>
      </section>
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
