import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NewsArticle } from "@types";
import { useDate, useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setSelectedArticle, setArticleTranslation } from "@renderer/features";
import { useNavigate } from "react-router-dom";
import { Rss, Languages, Loader2, RefreshCw } from "lucide-react";
import { logger } from "@renderer/logger";
import "./news-article-card.scss";

export interface NewsArticleCardProps {
  article: NewsArticle;
}

const getBaseLanguage = (lang: string | null) => lang?.split("-")[0] || "";

export function NewsArticleCard({ article }: NewsArticleCardProps) {
  const { t, i18n } = useTranslation("news");
  const { formatDistance } = useDate();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);

  const translation = useAppSelector(
    (state) => state.news.translations[article.id]
  );

  const [showOriginal, setShowOriginal] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationFailed, setTranslationFailed] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const translateCard = useCallback(async () => {
    const userLang = getBaseLanguage(i18n.language);
    if (!userLang) return;

    setIsTranslating(true);
    setTranslationFailed(false);

    try {
      const titleResult = await window.electron.news.translateText(
        article.title,
        userLang
      );

      const detectedLang = getBaseLanguage(titleResult.detectedLanguage);
      if (detectedLang === userLang) {
        dispatch(
          setArticleTranslation({
            articleId: article.id,
            translation: {
              title: article.title,
              contentSnippet: article.contentSnippet,
              detectedLanguage: titleResult.detectedLanguage,
            },
          })
        );
        return;
      }

      const snippetResult = article.contentSnippet
        ? await window.electron.news.translateText(
            article.contentSnippet,
            userLang
          )
        : { translatedText: "" };

      dispatch(
        setArticleTranslation({
          articleId: article.id,
          translation: {
            title: titleResult.translatedText,
            contentSnippet: snippetResult.translatedText,
            detectedLanguage: titleResult.detectedLanguage,
          },
        })
      );
    } catch (error) {
      logger.error(`Failed to translate article ${article.id}:`, error);
      setTranslationFailed(true);
    } finally {
      setIsTranslating(false);
    }
  }, [article, i18n.language, dispatch]);

  useEffect(() => {
    if (!isVisible || translation || isTranslating) return;

    const userLang = getBaseLanguage(i18n.language);
    if (!userLang) return;

    translateCard();
  }, [isVisible, translation, isTranslating, i18n.language, translateCard]);

  const needsTranslation =
    translation &&
    getBaseLanguage(translation.detectedLanguage) !==
      getBaseLanguage(i18n.language);

  const displayTitle =
    needsTranslation && !showOriginal ? translation.title : article.title;

  const displaySnippet =
    needsTranslation && !showOriginal
      ? translation.contentSnippet
      : article.contentSnippet;

  const handleClick = () => {
    dispatch(setSelectedArticle(article));
    navigate("/news/article");
  };

  const getLanguageName = (languageCode: string | null) => {
    if (!languageCode) return "";
    try {
      const displayNames = new Intl.DisplayNames([i18n.language], {
        type: "language",
      });
      return displayNames.of(languageCode) || languageCode.toUpperCase();
    } catch {
      return languageCode.toUpperCase();
    }
  };

  const relativeDate = article.pubDate
    ? formatDistance(new Date(article.pubDate), new Date(), {
        addSuffix: true,
      })
    : "";

  const visibleCategories = article.categories.slice(0, 3);

  const showTranslatingStatus = isTranslating;

  return (
    <div className="news-article-card" ref={cardRef}>
      <button
        type="button"
        className="news-article-card__main"
        onClick={handleClick}
      >
        {article.thumbnailUrl ? (
          <img
            className="news-article-card__thumbnail"
            src={article.thumbnailUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.parentElement!.classList.add(
                "news-article-card__thumbnail-placeholder"
              );
              el.style.display = "none";
            }}
          />
        ) : (
          <div className="news-article-card__thumbnail-placeholder">
            <Rss size={24} />
          </div>
        )}

        <div className="news-article-card__body">
          <div className="news-article-card__meta">
            <span className="news-article-card__source">
              {article.feedName}
            </span>
            {relativeDate && (
              <>
                <span className="news-article-card__dot" />
                <span className="news-article-card__date">{relativeDate}</span>
              </>
            )}
          </div>

          <p className="news-article-card__title">{displayTitle}</p>

          {displaySnippet && (
            <p className="news-article-card__snippet">{displaySnippet}</p>
          )}

          {visibleCategories.length > 0 && (
            <div className="news-article-card__categories">
              {visibleCategories.map((cat) => (
                <span key={cat} className="news-article-card__category">
                  {cat}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {needsTranslation && (
        <button
          type="button"
          className="news-article-card__translation-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setShowOriginal(!showOriginal);
          }}
        >
          <Languages size={13} />
          {showOriginal
            ? t("hide_original")
            : t("show_original_translated_from", {
                language: getLanguageName(translation.detectedLanguage),
              })}
        </button>
      )}

      {showTranslatingStatus && (
        <span className="news-article-card__translation-status">
          <Loader2 size={13} className="news-article-card__spinner" />
          {t("translating")}
        </span>
      )}

      {translationFailed && !translation && (
        <button
          type="button"
          className="news-article-card__translation-toggle"
          onClick={(e) => {
            e.stopPropagation();
            translateCard();
          }}
        >
          <RefreshCw size={13} />
          {t("retry_translation")}
        </button>
      )}
    </div>
  );
}
