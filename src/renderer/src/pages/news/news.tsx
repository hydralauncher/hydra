import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import {
  setArticles,
  setNewsLoading,
  setSearchQuery,
  setSelectedFeedId,
} from "@renderer/features";
import { NewsArticleCard } from "./news-article-card";
import { RefreshCw, Rss } from "lucide-react";
import { logger } from "@renderer/logger";
import type { RssFeed } from "@types";
import "./news.scss";

export default function News() {
  const { t } = useTranslation("news");
  const dispatch = useAppDispatch();

  const { articles, isLoading, searchQuery, selectedFeedId } = useAppSelector(
    (state) => state.news
  );

  const [feeds, setFeeds] = useState<RssFeed[]>([]);

  const fetchArticles = useCallback(async () => {
    dispatch(setNewsLoading(true));
    try {
      await window.electron.news.seedDefaultFeeds();
      const [fetchedFeeds, fetchedArticles] = await Promise.all([
        window.electron.news.getFeeds(),
        window.electron.news.fetchArticles(),
      ]);
      setFeeds(fetchedFeeds);
      dispatch(setArticles(fetchedArticles));
    } catch (error) {
      logger.error("Failed to fetch news articles:", error);
    } finally {
      dispatch(setNewsLoading(false));
    }
  }, [dispatch]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const filteredArticles = useMemo(() => {
    let result = articles;

    if (selectedFeedId) {
      result = result.filter((a) => a.feedId === selectedFeedId);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.feedName.toLowerCase().includes(query) ||
          a.contentSnippet.toLowerCase().includes(query)
      );
    }

    return result;
  }, [articles, selectedFeedId, searchQuery]);

  const handleFilterClick = (feedId: string | null) => {
    dispatch(setSelectedFeedId(feedId));
  };

  const renderContent = () => {
    if (isLoading && articles.length === 0) {
      return (
        <div className="news__skeleton-list">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="news__skeleton-card">
              <div className="news__skeleton-thumbnail" />
              <div className="news__skeleton-body">
                <div className="news__skeleton-line news__skeleton-line--short" />
                <div className="news__skeleton-line news__skeleton-line--long" />
                <div className="news__skeleton-line news__skeleton-line--medium" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (articles.length === 0) {
      return (
        <div className="news__empty">
          <Rss size={48} />
          <p>{t("no_articles")}</p>
        </div>
      );
    }

    if (filteredArticles.length === 0) {
      return (
        <div className="news__empty">
          <p>{t("no_search_results")}</p>
        </div>
      );
    }

    return (
      <div className="news__list">
        {filteredArticles.map((article) => (
          <NewsArticleCard key={article.id} article={article} />
        ))}
      </div>
    );
  };

  return (
    <section className="news">
      <div className="news__toolbar">
        <div className="news__filters">
          <button
            type="button"
            className={`news__filter-chip ${!selectedFeedId ? "news__filter-chip--active" : ""}`}
            onClick={() => handleFilterClick(null)}
          >
            {t("all_feeds")}
          </button>
          {feeds.map((feed) => (
            <button
              key={feed.id}
              type="button"
              className={`news__filter-chip ${selectedFeedId === feed.id ? "news__filter-chip--active" : ""}`}
              onClick={() => handleFilterClick(feed.id)}
            >
              {feed.name}
            </button>
          ))}
        </div>

        <input
          type="text"
          className="news__search"
          placeholder={t("search_placeholder")}
          value={searchQuery}
          onChange={(e) => dispatch(setSearchQuery(e.target.value))}
        />

        <button
          type="button"
          className="news__refresh-btn"
          onClick={fetchArticles}
          disabled={isLoading}
          title={t("refresh")}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {renderContent()}
    </section>
  );
}
