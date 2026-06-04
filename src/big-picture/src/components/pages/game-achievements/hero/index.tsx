import type { ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";

export interface GameAchievementsHeroProps {
  shopDetails: ShopDetailsWithAssets;
}

export function GameAchievementsHero({
  shopDetails,
}: Readonly<GameAchievementsHeroProps>) {
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
          backgroundImage: `url(${shopDetails.assets?.libraryHeroImageUrl})`,
        }}
      />

      <div className="game-achievements-page__hero-overlay">
        {shopDetails.assets?.logoImageUrl ? (
          <img
            src={shopDetails.assets.logoImageUrl}
            alt={shopDetails.assets?.title || ""}
            className="game-achievements-page__hero-logo"
          />
        ) : null}
      </div>
    </section>
  );
}
