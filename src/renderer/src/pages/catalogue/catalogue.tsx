import { Button, GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import type { CatalogueEntry } from "@types";

import { clearSearch } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { vars } from "../../theme.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as styles from "../home/home.css";
import { ArrowLeftIcon, ArrowRightIcon } from "@primer/octicons-react";

export function Catalogue() {
  const dispatch = useAppDispatch();

  const { t } = useTranslation("catalogue");

  const [searchResults, setSearchResults] = useState<CatalogueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const contentRef = useRef<HTMLElement>(null);

  const cursorRef = useRef<number>(0);

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const cursor = Number(searchParams.get("cursor") ?? 0);

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(`/game/${game.shop}/${game.objectID}`);
  };

  const [paginationSettings, setPaginationSettings] = useState({ resultsPerPage: 30 });

  useEffect(() => {
    async function fetchUserPreferences() {
        const [ userPreferences ] = await Promise.all([window.electron.getUserPreferences()]);
        const resultsPerPage = userPreferences?.resultsPerPage ?? 30;
        setPaginationSettings({ resultsPerPage });
    }

    fetchUserPreferences();
  }, []);

  const resultsPerPage = paginationSettings.resultsPerPage;

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setIsLoading(true);
    setSearchResults([]);

    window.electron
      .getGames(resultsPerPage, cursor)
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
  }, [dispatch, cursor, searchParams, resultsPerPage]);

  const handleNextPage = () => {
    const params = new URLSearchParams({
      cursor: cursorRef.current.toString(),
    });

    navigate(`/catalogue?${params.toString()}`);
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section
        style={{
          padding: `16px 32px`,
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${vars.color.borderColor}`,
        }}
      >
        <Button
          onClick={() => navigate(-1)}
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

      <section ref={contentRef} className={styles.content}>
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
      </section>
    </SkeletonTheme>
  );
}
