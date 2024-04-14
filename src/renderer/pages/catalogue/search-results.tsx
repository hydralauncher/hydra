import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { GameCard } from "@renderer/components";

import type { CatalogueEntry } from "@types";

import * as styles from "./catalogue.css";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { clearSearch } from "@renderer/features";
import { vars } from "@renderer/theme.css";

export function SearchResults() {
  const { results, isLoading } = useAppSelector((state) => state.search);
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(`/game/${game.shop}/${game.objectID}`);
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <section className={styles.content}>
        <section className={styles.cards({ searching: false })}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className={styles.cardSkeleton} />
              ))
            : results.map((game) => (
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
