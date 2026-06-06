import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import {
  Typography,
  VerticalFocusGroup,
  ScrollArea,
  Divider,
  FocusItem,
} from "../../components";
import { useHeaderTitle, useNavigationScreenActions } from "../../hooks";
import { CrackCalendarGame } from "@types";
import { formatCountdown } from "@renderer/utils/format-countdown";
import { useNavigationStore } from "../../stores";
import { NavigationService } from "../../services";

import "./styles.scss";

const SCROLL_STEP = 180;
const SCROLL_ANIMATION_DURATION = 220;
const HERO_SECTION_ID = "release-calendar-detail-hero";
const DESCRIPTION_ID = "release-calendar-detail-description";

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function ReleaseCalendarDetail() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const [game, setGame] = useState<CrackCalendarGame | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const navigation = NavigationService.getInstance();

  const monthCache = useAppSelector((state) => state.crackCalendar.monthCache);

  useEffect(() => {
    const cachedGame = Object.values(monthCache)
      .flatMap((month) => month.games)
      .find((g) => g.slug === slug);

    if (cachedGame) {
      setGame(cachedGame);
      setIsLoading(false);
    } else {
      window.electron.getCrackCalendarGame(slug!).then((res) => {
        setGame(res);
        setIsLoading(false);
      });
    }
  }, [slug, monthCache]);

  useHeaderTitle(
    game?.title || t("release_calendar", { defaultValue: "Release Calendar" })
  );

  const scrollPageBy = (delta: number) => {
    const scrollElement = scrollAreaRef.current;
    if (!scrollElement) return false;

    const nextScrollTop = clamp(
      scrollElement.scrollTop + delta,
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight
    );

    if (nextScrollTop === scrollElement.scrollTop) return false;

    if (scrollAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }

    const startScrollTop = scrollElement.scrollTop;
    const distance = nextScrollTop - startScrollTop;
    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = clamp(
        (now - startTime) / SCROLL_ANIMATION_DURATION,
        0,
        1
      );
      const easedProgress = easeOutCubic(progress);

      scrollElement.scrollTop = startScrollTop + distance * easedProgress;

      if (progress < 1) {
        scrollAnimationFrameRef.current = requestAnimationFrame(animate);
      } else {
        scrollElement.scrollTop = nextScrollTop;
        scrollAnimationFrameRef.current = null;
      }
    };

    scrollAnimationFrameRef.current = requestAnimationFrame(animate);
    return true;
  };

  useNavigationScreenActions(
    currentFocusId === DESCRIPTION_ID
      ? {
          direction: {
            up: () => {
              const scrollElement = scrollAreaRef.current;
              if (scrollElement && scrollElement.scrollTop > 10) {
                scrollPageBy(-SCROLL_STEP);
                return;
              }
              navigation.setFocus(HERO_SECTION_ID);
            },
            down: () => {
              const scrollElement = scrollAreaRef.current;
              if (
                scrollElement &&
                scrollElement.scrollTop <
                  scrollElement.scrollHeight - scrollElement.clientHeight - 10
              ) {
                scrollPageBy(SCROLL_STEP);
                return;
              }
            },
          },
        }
      : {}
  );

  if (isLoading) {
    return (
      <section className="release-calendar-detail">
        <Typography variant="body" className="status-message">
          Loading...
        </Typography>
      </section>
    );
  }

  if (!game) {
    return (
      <section className="release-calendar-detail">
        <Typography variant="body" className="status-message">
          Game not found
        </Typography>
      </section>
    );
  }

  return (
    <VerticalFocusGroup
      regionId="release-calendar-detail"
      getScrollAnchor={() => scrollAreaRef.current}
      asChild
    >
      <section className="release-calendar-detail">
        <ScrollArea className="detail-scroll-area">
          <div className="detail-container" ref={scrollAreaRef}>
            <div className="hero-section">
              <FocusItem id={HERO_SECTION_ID} asChild>
                <div className="cover-wrapper">
                  <img
                    src={game.image || ""}
                    alt={game.title}
                    className="cover-image"
                  />
                </div>
              </FocusItem>

              <div className="info-panel">
                <Typography variant="h1">{game.title}</Typography>
                <div className="status-badges">
                  <div
                    className={`badge ${game.crackStatus === "CRACKED" ? "cracked" : "not-cracked"}`}
                  >
                    {game.crackStatus}
                  </div>

                  {game.countdown && game.countdown !== "Released" && (
                    <div className="badge upcoming">
                      {formatCountdown(game.countdown)}
                    </div>
                  )}
                </div>
                {game.statusNote && (
                  <Typography variant="body" className="status-note">
                    {game.statusNote}
                  </Typography>
                )}

                <div className="details-grid">
                  <div className="detail-row">
                    <Typography variant="label">{t("Release Date")}</Typography>
                    <Typography variant="body">
                      {game.releaseDate || t("Unknown")}
                    </Typography>
                  </div>
                  <div className="detail-row">
                    <Typography variant="label">{t("Crack Date")}</Typography>
                    <Typography variant="body">
                      {game.crackDate || t("N/A")}
                    </Typography>
                  </div>
                  <div className="detail-row">
                    <Typography variant="label">{t("DRM Protection")}</Typography>
                    <Typography variant="body">
                      {game.drmProtection || t("Unknown")}
                    </Typography>
                  </div>
                  <div className="detail-row">
                    <Typography variant="label">{t("Scene Group")}</Typography>
                    <Typography variant="body">
                      {game.sceneGroup || t("N/A")}
                    </Typography>
                  </div>
                </div>

                {game.description && (
                  <FocusItem id={DESCRIPTION_ID} asChild>
                    <Typography variant="body" className="description">
                      {game.description}
                    </Typography>
                  </FocusItem>
                )}

                <div className="source">
                  <a href={game.source_url} target="_blank" rel="noreferrer">
                    <Typography variant="body">
                      {t("View on isitcracked.com")}
                    </Typography>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </section>
    </VerticalFocusGroup>
  );
}
