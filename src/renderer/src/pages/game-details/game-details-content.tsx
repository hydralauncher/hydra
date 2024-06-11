import { useContext, useEffect, useRef, useState } from "react";
import { average } from "color.js";
import Color from "color";

import { steamUrlBuilder } from "@renderer/helpers";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";

import * as styles from "./game-details.css";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";

export function GameDetailsContent() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { t } = useTranslation("game_details");

  const { objectID, shopDetails, game, gameColor, setGameColor } =
    useContext(gameDetailsContext);

  const [backdropOpactiy, setBackdropOpacity] = useState(1);

  const handleHeroLoad = async () => {
    const output = await average(steamUrlBuilder.libraryHero(objectID!), {
      amount: 1,
      format: "hex",
    });

    const backgroundColor = output
      ? (new Color(output).darken(0.7).toString() as string)
      : "";

    setGameColor(backgroundColor);
  };

  useEffect(() => {
    setBackdropOpacity(1);
  }, [objectID]);

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const scrollY = (event.target as HTMLDivElement).scrollTop;
    const opacity = Math.max(0, 1 - scrollY / styles.HERO_HEIGHT);

    if (scrollY >= styles.HERO_HEIGHT && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= styles.HERO_HEIGHT && isHeaderStuck) {
      setIsHeaderStuck(false);
    }

    setBackdropOpacity(opacity);
  };

  return (
    <div className={styles.wrapper}>
      <img
        src={steamUrlBuilder.libraryHero(objectID!)}
        className={styles.heroImage}
        alt={game?.title}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div className={styles.hero}>
          <div
            style={{
              backgroundColor: gameColor,
              flex: 1,
              opacity: Math.min(1, 1 - backdropOpactiy),
            }}
          />

          <div
            className={styles.heroLogoBackdrop}
            style={{ opacity: backdropOpactiy }}
          >
            <div className={styles.heroContent}>
              <img
                src={steamUrlBuilder.logo(objectID!)}
                style={{ width: 300, alignSelf: "flex-end" }}
                alt={game?.title}
              />
            </div>
          </div>
        </div>

        <HeroPanel isHeaderStuck={isHeaderStuck} />

        <div className={styles.descriptionContainer}>
          <div className={styles.descriptionContent}>
            <DescriptionHeader />
            <GallerySlider />

            <div
              dangerouslySetInnerHTML={{
                __html: shopDetails?.about_the_game ?? t("no_shop_details"),
              }}
              className={styles.description}
            />
          </div>

          <Sidebar />
        </div>
      </section>
    </div>
  );
}
