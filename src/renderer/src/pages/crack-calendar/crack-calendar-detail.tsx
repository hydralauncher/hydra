import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";

import { useAppSelector, useAppDispatch } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import type { CrackCalendarGame } from "@types";

import styles from "./crack-calendar-detail.module.scss";

export default function CrackCalendarDetail() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const dispatch = useAppDispatch();
  const { monthCache } = useAppSelector((state) => state.crackCalendar);

  const [game, setGame] = useState<CrackCalendarGame | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cachedGame = Object.values(monthCache)
      .flatMap((month) => (Array.isArray(month.games) ? month.games : []))
      .find((g) => g.slug === slug);

    if (cachedGame) {
      setGame(cachedGame);
      dispatch(setHeaderTitle(cachedGame.title));
      setIsLoading(false);
    } else if (slug) {
      window.electron.getCrackCalendarGame(slug).then((fetchedGame) => {
        setGame(fetchedGame);
        if (fetchedGame) dispatch(setHeaderTitle(fetchedGame.title));
        setIsLoading(false);
      });
    }

    return () => {
      dispatch(setHeaderTitle(""));
    };
  }, [slug, monthCache, dispatch]);

  if (isLoading) {
    return (
      <SkeletonTheme baseColor="#202020" highlightColor="#444">
        <div className={styles.container}>
          <div className={styles.skeletonLayout}>
            <Skeleton height={400} width={280} />
            <div className={styles.skeletonInfo}>
              <Skeleton height={40} width={300} />
              <Skeleton height={20} width={100} />
              <Skeleton count={5} />
            </div>
          </div>
        </div>
      </SkeletonTheme>
    );
  }

  if (!game) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>{t("Game not found")}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.layout}>
        <div className={styles.coverSection}>
          {game.image ? (
            <img src={game.image} alt={game.title} className={styles.coverImage} />
          ) : (
            <div className={styles.imagePlaceholder} />
          )}
        </div>

        <div className={styles.infoSection}>
          <h1 className={styles.title}>{game.title}</h1>

          <div className={cn(styles.crackBadge, {
            [styles.cracked]: game.crackStatus === "CRACKED",
            [styles.notCracked]: game.crackStatus === "NOT CRACKED",
            [styles.other]: game.crackStatus !== "CRACKED" && game.crackStatus !== "NOT CRACKED",
          })}>
            {game.crackStatus}
          </div>

          {game.statusNote && (
            <p className={styles.statusNote}>
              <em>{game.statusNote}</em>
            </p>
          )}

          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t("Release Date")}</span>
              <span className={styles.value}>{game.releaseDate || t("Unknown")}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t("Crack Date")}</span>
              <span className={styles.value}>{game.crackDate || t("N/A")}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t("DRM Protection")}</span>
              <span className={styles.value}>{game.drmProtection || t("Unknown")}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t("Scene Group")}</span>
              <span className={styles.value}>{game.sceneGroup || t("N/A")}</span>
            </div>
          </div>

          {game.description && (
            <div className={styles.description}>
              <p>{game.description}</p>
            </div>
          )}

          <div className={styles.source}>
            <a href={game.source_url} target="_blank" rel="noreferrer">
              {t("View on isitcracked.com")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
