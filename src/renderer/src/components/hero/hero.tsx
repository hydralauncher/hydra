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

const FEATURED_GAME_TITLE = "ELDEN RING";
const FEATURED_GAME_ID = "1245620";

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
          src="https://cdn2.steamgriddb.com/hero/95eb39b541856d43649b208b65b6ca9f.jpg"
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
