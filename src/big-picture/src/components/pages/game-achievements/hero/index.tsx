import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { resolvePreferredGameAssets } from "../../../../helpers";

export interface GameAchievementsHeroProps {
  shopDetails: ShopDetailsWithAssets;
  game: LibraryGame | null;
}

export function GameAchievementsHero({
  shopDetails,
  game,
}: Readonly<GameAchievementsHeroProps>) {
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, shopDetails.assets),
    [game, shopDetails.assets]
  );

  return (
    <section className="game-achievements-page__hero">
      <motion.div
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={{ scale: 1.08, x: -8, y: -8 }}
        transition={{
          duration: 20,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "mirror",
        }}
        className="game-achievements-page__hero-bg"
        style={{
          backgroundImage: `url(${preferredAssets.heroSrc})`,
        }}
      />

      <div className="game-achievements-page__hero-overlay">
        {preferredAssets.logoSrc ? (
          <img
            src={preferredAssets.logoSrc}
            alt={preferredAssets.title}
            className="game-achievements-page__hero-logo"
          />
        ) : null}
      </div>
    </section>
  );
}
