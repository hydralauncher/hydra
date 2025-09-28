import { useCallback, useContext, useEffect, useState } from "react";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { useAppSelector } from "@renderer/hooks";

export function GamePricesSection() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { t } = useTranslation("game_details");
  const [priceData, setPriceData] = useState<any>(null);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const { objectId } = useContext(gameDetailsContext);

  const fetchGamePrices = useCallback(async (steamAppId: string) => {
    setIsLoadingPrices(true);
    try {
      const apiKey =
        userPreferences?.ggDealsApiKey || import.meta.env.VITE_GG_DEALS_API_KEY;
      if (!apiKey) {
        setPriceData(null);
        setIsLoadingPrices(false);
        return;
      }
      const url = `${import.meta.env.VITE_GG_DEALS_API_URL}/?ids=${steamAppId}&key=${apiKey}&region=br`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      setPriceData(data.data?.[steamAppId] ?? null);
    } catch (error) {
      setPriceData(null);
    } finally {
      setIsLoadingPrices(false);
    }
  }, []);

  useEffect(() => {
    if (objectId) {
      fetchGamePrices(objectId.toString());
    }
  }, [objectId, fetchGamePrices]);

  return (
    <SidebarSection title={t("prices")}>
      {isLoadingPrices ? (
        <div>{t("loading")}</div>
      ) : priceData ? (
        <div>
          <ul className="">
            <li>
              <b>{t("retail_price")}</b>: {t("currency_symbol")}
              {priceData.prices.currentRetail}
            </li>
            <li>
              <b>{t("keyshop_price")}</b>: {t("currency_symbol")}
              {priceData.prices.currentKeyshops}
            </li>
            <li>
              <b>{t("historical_retail")}</b>: {t("currency_symbol")}
              {priceData.prices.historicalRetail}
            </li>
            <li>
              <b>{t("historical_keyshop")}</b>: {t("currency_symbol")}
              {priceData.prices.historicalKeyshops}
            </li>
            <li>
              <a
                href={priceData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="list__item"
              >
                {t("view_all_prices")}
              </a>
            </li>
          </ul>
        </div>
      ) : (
        <div>{t("no_prices_found")}</div>
      )}
    </SidebarSection>
  );
}
