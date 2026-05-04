import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppSelector, useAppDispatch, useDate } from "@renderer/hooks";
import {
  setArticleTranslation,
  setArticleContentTranslation,
} from "@renderer/features";
import {
  ArrowLeft,
  ExternalLink,
  Languages,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { logger } from "@renderer/logger";
import "./news-article.scss";

type ViewMode = "loading" | "scraped" | "webview";

const getBaseLanguage = (lang: string | null) => lang?.split("-")[0] || "";

function cleanArticleHtml(html: string, title: string): string {
  let cleaned = html;

  // Remove the first <h1> if it matches the article title
  const h1Match = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1Text = h1Match[1].replace(/<[^>]*>/g, "").trim();
    const titleText = title.trim();
    if (
      h1Text.length > 0 &&
      titleText.length > 0 &&
      (h1Text.toLowerCase() === titleText.toLowerCase() ||
        titleText.toLowerCase().includes(h1Text.toLowerCase()) ||
        h1Text.toLowerCase().includes(titleText.toLowerCase()))
    ) {
      cleaned = cleaned.replace(h1Match[0], "");
    }
  }

  // Remove the first <img> (hero image is shown separately)
  cleaned = cleaned.replace(/<img[^>]*\/?>/i, "");

  return cleaned;
}

export default function NewsArticlePage() {
  const { t, i18n } = useTranslation("news");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { formatDistance } = useDate();
  const webviewRef = useRef<HTMLWebViewElement>(null);
  const contentTranslatingRef = useRef(false);

  const article = useAppSelector((state) => state.news.selectedArticle);
  const translation = useAppSelector((state) =>
    article ? state.news.translations[article.id] : undefined
  );

  const [viewMode, setViewMode] = useState<ViewMode>("loading");
  const [scrapedContent, setScrapedContent] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationFailed, setTranslationFailed] = useState(false);

  useEffect(() => {
    if (!article) return;

    const hasRssContent =
      article.content && article.content.trim().length > 500;

    if (hasRssContent) {
      setScrapedContent(article.content);
      setViewMode("scraped");
      return;
    }

    let cancelled = false;

    const tryScrape = async () => {
      try {
        const result = await window.electron.news.scrapeArticle(article.link);
        if (cancelled) return;

        if (result?.content) {
          setScrapedContent(result.content);
          setViewMode("scraped");
        } else {
          setViewMode("webview");
        }
      } catch (error) {
        logger.error("Failed to scrape article:", error);
        if (!cancelled) {
          setViewMode("webview");
        }
      }
    };

    tryScrape();

    return () => {
      cancelled = true;
    };
  }, [article]);

  const translateArticle = useCallback(async () => {
    if (!article || !scrapedContent) return;

    const userLang = getBaseLanguage(i18n.language);
    if (!userLang) return;

    setIsTranslating(true);
    setTranslationFailed(false);

    try {
      let detectedLang = translation
        ? getBaseLanguage(translation.detectedLanguage)
        : null;

      if (!translation) {
        const titleResult = await window.electron.news.translateText(
          article.title,
          userLang
        );
        detectedLang = getBaseLanguage(titleResult.detectedLanguage);
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
      }

      if (detectedLang === userLang) return;

      const contentResult = await window.electron.news.translateText(
        scrapedContent,
        userLang
      );

      dispatch(
        setArticleContentTranslation({
          articleId: article.id,
          content: contentResult.translatedText,
        })
      );
    } catch (error) {
      logger.error("Failed to translate article content:", error);
      setTranslationFailed(true);
    } finally {
      setIsTranslating(false);
      contentTranslatingRef.current = false;
    }
  }, [article, scrapedContent, i18n.language, dispatch, translation]);

  useEffect(() => {
    if (!article || !scrapedContent) return;
    if (contentTranslatingRef.current) return;
    if (translation?.content) return;

    const userLang = getBaseLanguage(i18n.language);
    if (!userLang) return;

    contentTranslatingRef.current = true;
    translateArticle();
  }, [article, scrapedContent, i18n.language, translation, translateArticle]);

  const needsTranslation =
    article &&
    translation &&
    getBaseLanguage(translation.detectedLanguage) !==
      getBaseLanguage(i18n.language);

  const displayTitle =
    needsTranslation && !showOriginal
      ? translation.title
      : (article?.title ?? "");

  const displayContent = useMemo(() => {
    const raw =
      needsTranslation && !showOriginal && translation?.content
        ? translation.content
        : scrapedContent;
    if (!raw || !article) return null;
    return cleanArticleHtml(raw, article.title);
  }, [scrapedContent, translation, needsTranslation, showOriginal, article]);

  if (!article) {
    return (
      <section className="news-article">
        <button
          type="button"
          className="news-article__back-btn"
          onClick={() => navigate("/news")}
        >
          <ArrowLeft size={16} />
          {t("back_to_news")}
        </button>
        <div className="news-article__not-found">
          <p>{t("article_not_found")}</p>
        </div>
      </section>
    );
  }

  const relativeDate = article.pubDate
    ? formatDistance(new Date(article.pubDate), new Date(), {
        addSuffix: true,
      })
    : "";

  const handleOpenOriginal = () => {
    window.electron.openExternal(article.link);
  };

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor?.href) {
      e.preventDefault();
      window.electron.openExternal(anchor.href);
    }
  };

  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      const anchor = (e.target as HTMLElement).closest("a");
      if (anchor?.href) {
        e.preventDefault();
        window.electron.openExternal(anchor.href);
      }
    }
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

  return (
    <section
      className={`news-article ${viewMode === "webview" ? "news-article--has-webview" : ""}`}
    >
      <button
        type="button"
        className="news-article__back-btn"
        onClick={() => navigate("/news")}
      >
        <ArrowLeft size={16} />
        {t("back_to_news")}
      </button>

      <div className="news-article__header">
        <div className="news-article__meta">
          <span className="news-article__source">{article.feedName}</span>
          {relativeDate && (
            <>
              <span className="news-article__dot" />
              <span className="news-article__date">{relativeDate}</span>
            </>
          )}
        </div>

        <h1 className="news-article__title">{displayTitle}</h1>

        {article.categories.length > 0 && (
          <div className="news-article__categories">
            {article.categories.map((cat) => (
              <span key={cat} className="news-article__category">
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {viewMode === "loading" && (
        <div className="news-article__loading">
          <Loader2 size={24} className="news-article__spinner" />
          <p>{t("loading_article")}</p>
        </div>
      )}

      {viewMode === "scraped" && (
        <>
          {article.thumbnailUrl && (
            <img
              className="news-article__hero"
              src={article.thumbnailUrl}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}

          {displayContent && (
            /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- intercepts anchor clicks to open externally */
            <div
              role="article"
              className="news-article__content"
              dangerouslySetInnerHTML={{ __html: displayContent }}
              onClick={handleContentClick}
              onKeyDown={handleContentKeyDown}
            />
          )}

          {needsTranslation && (
            <button
              type="button"
              className="news-article__translation-toggle"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              <Languages size={13} />
              {showOriginal
                ? t("hide_original")
                : t("show_original_translated_from", {
                    language: getLanguageName(translation.detectedLanguage),
                  })}
            </button>
          )}

          {isTranslating && (
            <span className="news-article__translation-status">
              <Loader2 size={13} className="news-article__spinner" />
              {t("translating")}
            </span>
          )}

          {translationFailed && !translation?.content && (
            <button
              type="button"
              className="news-article__translation-toggle"
              onClick={() => translateArticle()}
            >
              <RefreshCw size={13} />
              {t("retry_translation")}
            </button>
          )}

          <button
            type="button"
            className="news-article__open-original"
            onClick={handleOpenOriginal}
          >
            <ExternalLink size={14} />
            {t("read_original")}
          </button>
        </>
      )}

      {viewMode === "webview" && (
        <div className="news-article__webview-container">
          <div className="news-article__webview-toolbar">
            <div className="news-article__webview-info">
              <span className="news-article__webview-source">
                {article.link}
              </span>
            </div>

            <button
              type="button"
              className="news-article__open-external-btn"
              onClick={handleOpenOriginal}
              title={t("read_original")}
            >
              <ExternalLink size={14} />
            </button>
          </div>

          <webview
            ref={webviewRef}
            className="news-article__webview"
            src={article.link}
            /* eslint-disable-next-line react/no-unknown-property */
            allowpopups={true}
          />
        </div>
      )}
    </section>
  );
}
