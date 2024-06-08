import { useNavigate } from "react-router-dom";
import * as styles from "./hero.css";
import { useEffect, useState } from "react";
import { ShopDetails } from "@types";
import {
  buildGameDetailsPath,
  getSteamLanguage,
  steamUrlBuilder,
} from "@renderer/helpers";
import { useTranslation } from "react-i18next";

const FEATURED_GAME_TITLE = "Horizon Forbidden West™ Complete Edition";
const FEATURED_GAME_ID = "2420110";

export function Hero() {
  const [featuredGameDetails, setFeaturedGameDetails] =
    useState<ShopDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { i18n } = useTranslation();

  const navigate = useNavigate();

  useEffect(() => {
    setIsLoading(true);

    window.electron
      .getGameShopDetails(
        FEATURED_GAME_ID,
        "steam",
        getSteamLanguage(i18n.language)
      )
      .then((result) => {
        setFeaturedGameDetails(result);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [i18n.language]);

  return (
    <button
      type="button"
      onClick={() =>
        navigate(
          buildGameDetailsPath({
            title: FEATURED_GAME_TITLE,
            objectID: FEATURED_GAME_ID,
            shop: "steam",
          })
        )
      }
      className={styles.hero}
    >
      <div className={styles.backdrop}>
        <img
          src={steamUrlBuilder.libraryHero(FEATURED_GAME_ID)}
          alt={FEATURED_GAME_TITLE}
          className={styles.heroMedia}
        />

        <div className={styles.content}>
          <img
            src={steamUrlBuilder.logo(FEATURED_GAME_ID)}
            width="250px"
            alt={FEATURED_GAME_TITLE}
          />

          {!isLoading && featuredGameDetails && (
            <p className={styles.description}>
              {featuredGameDetails?.short_description}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
