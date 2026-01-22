import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ImageIcon, ClockIcon, TrophyIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { darkenColor } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { average } from "color.js";
import type { Game, GameShop, ShopAssets } from "@types";
import "./game-launcher.scss";

export default function GameLauncher() {
  const { t } = useTranslation("game_launcher");
  const [searchParams] = useSearchParams();

  const shop = searchParams.get("shop") as GameShop;
  const objectId = searchParams.get("objectId");

  const [game, setGame] = useState<Game | null>(null);
  const [gameAssets, setGameAssets] = useState<ShopAssets | null>(null);
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [colorExtracted, setColorExtracted] = useState(false);
  const [colorError, setColorError] = useState(false);
  const [windowShown, setWindowShown] = useState(false);

  const formatPlayTime = useCallback(
    (playTimeInMilliseconds = 0) => {
      const minutes = playTimeInMilliseconds / 60000;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes_short", { amount: minutes.toFixed(0) });
      }

      const hours = minutes / 60;
      return t("amount_hours_short", { amount: hours.toFixed(1) });
    },
    [t]
  );

  useEffect(() => {
    if (shop && objectId) {
      window.electron.getGameByObjectId(shop, objectId).then((gameData) => {
        setGame(gameData);
      });

      window.electron.getGameAssets(objectId, shop).then((assets) => {
        setGameAssets(assets);
      });
    }
  }, [shop, objectId]);

  useEffect(() => {
    if (!windowShown) return;

    const timer = setTimeout(() => {
      window.electron.closeGameLauncherWindow();
    }, 5000);

    return () => clearTimeout(timer);
  }, [windowShown]);

  const handleOpenHydra = () => {
    window.electron.openMainWindow();
    window.electron.closeGameLauncherWindow();
  };

  const coverImage =
    gameAssets?.coverImageUrl?.replaceAll("\\", "/") ||
    game?.iconUrl?.replaceAll("\\", "/") ||
    game?.libraryHeroImageUrl?.replaceAll("\\", "/") ||
    "";
  const gameTitle = game?.title ?? gameAssets?.title ?? "";
  const playTime = game?.playTimeInMilliseconds ?? 0;
  const achievementCount = game?.achievementCount ?? 0;
  const unlockedAchievements = game?.unlockedAchievementCount ?? 0;

  const extractAccentColor = useCallback(async (imageUrl: string) => {
    try {
      const color = await average(imageUrl, { amount: 1, format: "hex" });
      const colorString = typeof color === "string" ? color : color.toString();
      setAccentColor(colorString);
    } catch (error) {
      logger.error("Failed to extract accent color:", error);
      setColorError(true);
    } finally {
      setColorExtracted(true);
    }
  }, []);

  useEffect(() => {
    if (coverImage && !colorExtracted) {
      extractAccentColor(coverImage);
    }
  }, [coverImage, colorExtracted, extractAccentColor]);

  const isReady = imageLoaded && colorExtracted && !colorError;
  const hasFailed =
    imageError || colorError || (!coverImage && gameAssets !== null);

  useEffect(() => {
    if (windowShown) return;

    if (hasFailed) {
      window.electron.closeGameLauncherWindow();
      return;
    }

    if (isReady) {
      window.electron.showGameLauncherWindow();
      setWindowShown(true);
    }
  }, [isReady, hasFailed, windowShown]);

  const backgroundStyle = accentColor
    ? {
        background: `linear-gradient(135deg, ${darkenColor(accentColor, 0.7)} 0%, ${darkenColor(accentColor, 0.8, 0.9)} 50%, ${darkenColor(accentColor, 0.85, 0.8)} 100%)`,
      }
    : undefined;

  const glowStyle = accentColor
    ? {
        background: `radial-gradient(ellipse at top right, ${darkenColor(accentColor, 0.3, 0.15)} 0%, transparent 50%)`,
      }
    : undefined;

  return (
    <div className="game-launcher" style={backgroundStyle}>
      <div className="game-launcher__glow" style={glowStyle} />

      <div className="game-launcher__logo-badge">
        <HydraIcon />
      </div>

      <div className="game-launcher__content">
        {imageError || !coverImage ? (
          <div className="game-launcher__cover-placeholder">
            <ImageIcon size={32} />
          </div>
        ) : (
          <>
            {!isReady && (
              <div className="game-launcher__cover-placeholder">
                <ImageIcon size={32} />
              </div>
            )}
            <img
              src={coverImage}
              alt={gameTitle}
              className="game-launcher__cover"
              style={{ display: isReady ? "block" : "none" }}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}

        <div className="game-launcher__info">
          <div className="game-launcher__center">
            <h1 className="game-launcher__title">{gameTitle}</h1>

            <p className="game-launcher__status">
              {t("launching_base")}
              <span className="game-launcher__dots" />
            </p>

            <button
              type="button"
              className="game-launcher__button"
              onClick={handleOpenHydra}
            >
              {t("open_hydra")}
            </button>
          </div>

          {(playTime > 0 || achievementCount > 0) && (
            <div className="game-launcher__stats">
              {playTime > 0 && (
                <span className="game-launcher__stat">
                  <ClockIcon size={14} />
                  {formatPlayTime(playTime)}
                </span>
              )}

              {achievementCount > 0 && (
                <span className="game-launcher__stat">
                  <TrophyIcon size={14} />
                  {unlockedAchievements}/{achievementCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
