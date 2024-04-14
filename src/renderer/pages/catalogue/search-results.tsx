import { GameCard } from "@renderer/components";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import type { CatalogueEntry } from "@types";

import { InboxIcon } from "@primer/octicons-react";
import { clearSearch } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { vars } from "@renderer/theme.css";
import { useNavigate } from "react-router-dom";
import * as styles from "./catalogue.css";

export function SearchResults() {
  const { results, isLoading } = useAppSelector((state) => state.search);
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const handleGameClick = (game: CatalogueEntry) => {
    dispatch(clearSearch());
    navigate(`/game/${game.shop}/${game.objectID}`, { replace: true });
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <main className={styles.content}>
				<section className={styles.cards({ searching: false })}>
					{isLoading &&
						Array.from({ length: 12 }).map((_, index) => (
							<Skeleton
								key={index}
								className={styles.cardSkeleton}
							/>
						))}

					{!isLoading && results.length > 0 && (
						<>
							{results.map((game) => (
								<GameCard
									key={game.objectID}
									game={game}
									onClick={() => handleGameClick(game)}
									disabled={!game.repacks.length}
								/>
							))}
						</>
					)}
				</section>

				{!isLoading && results.length === 0 && (
					<div className={styles.noResults}>
						<InboxIcon size={56} />

						<p>Nenhum resultado encontrado</p>
					</div>
				)}
			</main>
    </SkeletonTheme>
  );
}
