import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { ShopAssets, ShopDetailsWithAssets } from "@types";
import {
  buildGameDetailsPath,
  getSteamLanguage,
  globalImageCache,
} from "@renderer/helpers";
import { useSteamGridHeroAndLogo } from "@renderer/hooks/use-steamgrid-cover";
import { Button } from "@renderer/components";
import Skeleton from "react-loading-skeleton";
import "./hero-carousel.scss";

interface HeroCarouselProps {
  games: ShopAssets[];
}

const detailsCache = new Map<string, ShopDetailsWithAssets>();

function formatDate(dateStr: string): string {
  const parts = dateStr.replace(/\./g, "").split(/[\s/]+/);
  if (parts.length < 3) return dateStr;

  const months: Record<string, string> = {
    jan: "Jan",
    feb: "Feb",
    mar: "Mar",
    apr: "Apr",
    may: "May",
    jun: "Jun",
    jul: "Jul",
    aug: "Aug",
    sep: "Sep",
    oct: "Oct",
    nov: "Nov",
    dec: "Dec",
    janeiro: "Jan",
    fevereiro: "Feb",
    março: "Mar",
    abril: "Apr",
    maio: "May",
    junho: "Jun",
    julho: "Jul",
    agosto: "Aug",
    setembro: "Sep",
    outubro: "Oct",
    novembro: "Nov",
    dezembro: "Dec",
  };

  const year = parts.find((p) => p.length === 4 && !isNaN(Number(p)));
  const monthPart = parts.find((p) =>
    Object.keys(months).some((m) => p.toLowerCase().startsWith(m))
  );

  if (!year) return dateStr;
  const monthKey = monthPart
    ? Object.keys(months).find((m) => monthPart.toLowerCase().startsWith(m))
    : undefined;
  const month = monthKey ? months[monthKey] : "";

  return month ? `${month}. ${year}` : year;
}

function cleanPublisher(raw: string): string {
  return raw
    .replace(
      /\s*(co\.,?\s*ltd\.?|inc\.?|llc\.?|corp\.?|ltd\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|entertainment|interactive|studios?|games?|publishing)/gi,
      ""
    )
    .replace(/[,.\s]+$/, "")
    .trim();
}

function CarouselSlide({
  game,
  isActive,
}: {
  game: ShopAssets;
  isActive: boolean;
}) {
  const { i18n, t } = useTranslation("home");
  const navigate = useNavigate();

  const [details, setDetails] = useState<ShopDetailsWithAssets | null>(
    detailsCache.get(game.objectId) ?? null
  );

  const initialBgImage =
    game.libraryHeroImageUrl ||
    (game.shop === "steam"
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_hero.jpg`
      : game.libraryImageUrl);

  const initialLogoImage =
    game.logoImageUrl ||
    (game.shop === "steam"
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/logo.png`
      : undefined);

  const [bgPrimaryFailed, setBgPrimaryFailed] = useState(!initialBgImage);
  const [logoPrimaryFailed, setLogoPrimaryFailed] = useState(!initialLogoImage);
  const [bgFinalFailed, setBgFinalFailed] = useState(false);

  const steamGridArt = useSteamGridHeroAndLogo(
    game.objectId,
    game.title,
    bgPrimaryFailed || logoPrimaryFailed
  );

  const bgImage = bgPrimaryFailed
    ? (steamGridArt.heroUrl ?? game.libraryImageUrl ?? null)
    : initialBgImage;

  const logoImage = logoPrimaryFailed ? steamGridArt.logoUrl : initialLogoImage;

  const imgRef = useRef<HTMLImageElement>(null);
  const fetchedRef = useRef<string>("");

  const [imageLoaded, setImageLoaded] = useState(() =>
    bgImage ? globalImageCache.has(bgImage) : false
  );

  useEffect(() => {
    setImageLoaded(bgImage ? globalImageCache.has(bgImage) : false);
    if (
      bgImage &&
      imgRef.current?.complete &&
      imgRef.current.naturalWidth > 0
    ) {
      globalImageCache.add(bgImage);
      setImageLoaded(true);
    }
  }, [bgImage]);

  useEffect(() => {
    const key = game.objectId;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const cached = detailsCache.get(key);
    if (cached) {
      setDetails(cached);
      return;
    }

    window.electron
      .getGameShopDetails(key, game.shop, getSteamLanguage(i18n.language))
      .then((result) => {
        if (result) detailsCache.set(key, result);
        setDetails(result);
      })
      .catch(() => {});
  }, [game.objectId, game.shop, i18n.language]);

  const publisher = details?.publishers?.[0]
    ? cleanPublisher(details.publishers[0])
    : "";
  const date = details?.release_date?.date
    ? formatDate(details.release_date.date)
    : "";
  const meta = [publisher, date].filter(Boolean).join(" - ");

  return (
    <div
      className={cn("hero-carousel__slide", {
        "hero-carousel__slide--active": isActive,
      })}
    >
      {!imageLoaded && !bgFinalFailed && (
        <Skeleton
          className="hero-carousel__image-skeleton"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            width: "100%",
            height: "100%",
          }}
        />
      )}
      {!bgFinalFailed && bgImage && (
        <img
          ref={imgRef}
          key={bgImage}
          src={bgImage ?? undefined}
          alt={game.title}
          className="hero-carousel__image"
          loading="lazy"
          draggable={false}
          onLoad={() => {
            if (bgImage) globalImageCache.add(bgImage);
            setImageLoaded(true);
          }}
          style={{
            opacity: imageLoaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
          onError={() => {
            if (!bgPrimaryFailed) {
              setBgPrimaryFailed(true);
            } else {
              setBgFinalFailed(true);
              setImageLoaded(true);
            }
          }}
        />
      )}

      <div className="hero-carousel__overlay">
        <div className="hero-carousel__footer">
          <div className="hero-carousel__content">
            {logoImage && !logoPrimaryFailed ? (
              <img
                src={logoImage}
                alt={game.title}
                className="hero-carousel__logo"
                loading="lazy"
                onError={() => setLogoPrimaryFailed(true)}
              />
            ) : steamGridArt.logoUrl && logoPrimaryFailed ? (
              <img
                src={steamGridArt.logoUrl}
                alt={game.title}
                className="hero-carousel__logo"
                loading="lazy"
                onError={() => {}}
              />
            ) : (
              <h3 className="hero-carousel__title">{game.title}</h3>
            )}
            {meta && <span className="hero-carousel__meta">{meta}</span>}
          </div>

          <Button
            className="hero-carousel__view-button"
            theme="primary"
            onClick={() => navigate(buildGameDetailsPath(game))}
          >
            {t("see_more", "Ver mais")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function HeroCarousel({ games }: Readonly<HeroCarouselProps>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { t } = useTranslation("home");

  const featuredGames = games.slice(0, 3);

  // Auto slide
  useEffect(() => {
    if (featuredGames.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % featuredGames.length);
    }, 6000);

    return () => clearInterval(interval);
  }, [featuredGames.length]);

  if (featuredGames.length === 0) return null;

  return (
    <div className="hero-carousel-container">
      <h3 className="hero-carousel-container__title">
        {t("featured_games", "Jogos em Destaque")}
      </h3>
      <div className="hero-carousel">
        <div className="hero-carousel__slides">
          {featuredGames.map((game, index) => (
            <CarouselSlide
              key={game.objectId}
              game={game}
              isActive={index === currentIndex}
            />
          ))}
        </div>
      </div>

      {featuredGames.length > 1 && (
        <div className="hero-carousel__indicators">
          {featuredGames.map((_, index) => (
            <button
              key={index}
              type="button"
              className={cn("hero-carousel__indicator", {
                "hero-carousel__indicator--active": index === currentIndex,
              })}
              onClick={() => setCurrentIndex(index)}
              aria-label={`Slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
