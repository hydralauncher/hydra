import type { LibraryGame } from "@types";
import { useEffect, useState } from "react";
import { AnimatedHeroImage } from "../../common";

import "./hero.scss";

interface LibraryHeroProps {
  lastPlayedGames: LibraryGame[];
}

const FEATURED_GAME_INTERVAL = 15000;

export function LibraryHero({ lastPlayedGames }: Readonly<LibraryHeroProps>) {
  const [featuredGameIndex, setFeaturedGameIndex] = useState(0);

  useEffect(() => {
    if (lastPlayedGames.length <= 1) {
      setFeaturedGameIndex(0);
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setFeaturedGameIndex((currentIndex) => {
        return (currentIndex + 1) % lastPlayedGames.length;
      });
    }, FEATURED_GAME_INTERVAL);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [lastPlayedGames]);

  const featuredGame = lastPlayedGames[featuredGameIndex] ?? null;

  return (
    <section className="hero">
      <AnimatedHeroImage
        className="hero__bg"
        imageUrl={featuredGame?.libraryHeroImageUrl ?? ""}
      />

      <div className="hero__overlay" />

      <div className="hero__content">
        <div>
          <div>logo</div>
          <div>title description</div>
          <div>actions</div>
        </div>
        <div>counts</div>
      </div>
    </section>
  );
}
