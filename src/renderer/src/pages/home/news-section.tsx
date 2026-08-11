import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NewsArticle } from "@types";
import { ImageIcon } from "@primer/octicons-react";
import "./news-section.scss";

const MAX_CARDS = 5;

interface NewsSectionProps {
  gameTitle?: string | null;
  gameImageUrls?: string[];
}

function formatTimeAgo(dateStr: string, locale: string): string {
  const date = new Date(dateStr).getTime();
  if (Number.isNaN(date)) return "";

  const diffSeconds = Math.round((date - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsInUnit || unit === "minute") {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }

  return "";
}

export function NewsSection({
  gameTitle,
  gameImageUrls = [],
}: Readonly<NewsSectionProps>) {
  const { t, i18n } = useTranslation("home");
  const [generalArticles, setGeneralArticles] = useState<NewsArticle[]>([]);
  const [gameArticles, setGameArticles] = useState<NewsArticle[]>([]);

  useEffect(() => {
    window.electron
      .getGameNews(i18n.language)
      .then((news) => setGeneralArticles(news))
      .catch(() => setGeneralArticles([]));
  }, [i18n.language]);

  useEffect(() => {
    if (!gameTitle) {
      setGameArticles([]);
      return;
    }

    let cancelled = false;
    window.electron
      .getGameSpecificNews(gameTitle, i18n.language)
      .then((news) => {
        if (!cancelled) setGameArticles(news);
      })
      .catch(() => {
        if (!cancelled) setGameArticles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [gameTitle, i18n.language]);

  const isShowingGameNews = gameArticles.length > 0;
  const articles = (isShowingGameNews ? gameArticles : generalArticles).slice(
    0,
    MAX_CARDS
  );

  if (articles.length === 0) return null;

  return (
    <div className="news-section-container">
      <h3 className="news-section-container__title">
        {isShowingGameNews
          ? t("noticias_sobre", {
              defaultValue: "Notícias sobre {{game}}",
              game: gameTitle,
            })
          : t("noticias_recentes", { defaultValue: "Notícias recentes" })}
      </h3>
      <div className="news-section">
        {articles.map((article, index) => {
          const fallbackImageUrl =
            isShowingGameNews && gameImageUrls.length > 0
              ? gameImageUrls[index % gameImageUrls.length]
              : null;
          const imageUrl = article.imageUrl ?? fallbackImageUrl;

          return (
          <a
            key={article.id}
            className="news-section__card"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="news-section__image-wrapper">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="news-section__image"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className="news-section__image-placeholder">
                  <ImageIcon size={20} />
                </div>
              )}
            </div>

            <div className="news-section__content">
              <h4 className="news-section__title">{article.title}</h4>
              <span className="news-section__meta">
                {article.source} ·{" "}
                {formatTimeAgo(article.publishedAt, i18n.language)}
              </span>
            </div>
          </a>
          );
        })}
      </div>
    </div>
  );
}
