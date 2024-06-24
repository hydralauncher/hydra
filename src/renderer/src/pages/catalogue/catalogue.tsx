import { Button, GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import type { CatalogueEntry } from "@types";

import { clearSearch } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as styles from "../home/home.css";
import { ArrowLeftIcon, ArrowRightIcon } from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";

import { SPACING_UNIT, vars } from "@renderer/theme.css";

export function Catalogue() {
  const dispatch = useAppDispatch();

  const { t } = useTranslation("catalogue");

  const [searchResults, setSearchResults] = useState<CatalogueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingInfScroll, setIsLoadingInfScroll] = useState(false);
  const [resultsExhausted, setResultsExhausted] = useState(false);

  const contentRef = useRef<HTMLElement>(null);

  const cursorRef = useRef<number>(0);
  const cursorInfScrollRef = useRef<number>(cursorRef.current + 24);

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const cursor = Number(searchParams.get("cursor") ?? 0);

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(buildGameDetailsPath(game));
  };

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setIsLoading(true);
    setSearchResults([]);

    window.electron
      .getGames(24, cursor)
      .then(({ results, cursor }) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            cursorRef.current = cursor;
            setSearchResults(results);
            resolve(null);
          }, 500);
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [dispatch, cursor, searchParams]);

  const handleNextPage = () => {
    const params = new URLSearchParams({
      cursor: cursorRef.current.toString(),
    });

    resetInfiniteScroll()

    navigate(`/catalogue?${params.toString()}`);
  };

  const resetInfiniteScroll = () =>{
    cursorInfScrollRef.current = cursorRef.current + 24
    setResultsExhausted(false)
  }

  const infiniteLoading = () => {
    if(resultsExhausted) return
    const isAtBottom = contentRef.current?.offsetHeight! + contentRef.current?.scrollTop! == contentRef.current?.scrollHeight

    if (isAtBottom) {
      setIsLoadingInfScroll(true);
      window.electron
        .getGames(24, cursorInfScrollRef.current)
        .then(({ results, cursor }) => {
          return new Promise((resolve) => {
            if (results.length == 0) {
              setResultsExhausted(true)
            }
            setTimeout(() => {
              cursorInfScrollRef.current += cursor;
              setSearchResults([...searchResults, ...results]);
              resolve(null);
            }, 500);
          });
        })
        .finally(() => {
          setIsLoadingInfScroll(false);
        });
    }
  }

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section
        style={{
          padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 4}px`,
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${vars.color.border}`,
        }}
      >
        <Button
          onClick={() => { resetInfiniteScroll(); navigate(-1) }}
          theme="outline"
          disabled={cursor === 0 || isLoading}
        >
          <ArrowLeftIcon />
          {t("previous_page")}
        </Button>

        <Button onClick={handleNextPage} theme="outline" disabled={isLoading}>
          {t("next_page")}
          <ArrowRightIcon />
        </Button>
      </section>

      <section ref={contentRef} className={styles.content} onScroll={infiniteLoading}>
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

        {isLoadingInfScroll &&
            Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className={styles.cardSkeleton} />
            ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
