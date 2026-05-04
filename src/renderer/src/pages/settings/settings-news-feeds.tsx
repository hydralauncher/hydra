import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@renderer/hooks";
import { Button, ConfirmationModal } from "@renderer/components";
import { NoEntryIcon, PlusCircleIcon, LinkIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import type { RssFeed } from "@types";
import "./settings-news-feeds.scss";

export function SettingsNewsFeeds() {
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [feedToRemove, setFeedToRemove] = useState<RssFeed | null>(null);

  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const fetchFeeds = async () => {
    try {
      const result = await window.electron.news.getFeeds();
      setFeeds(result);
    } catch (error) {
      logger.error("Failed to fetch RSS feeds:", error);
    }
  };

  useEffect(() => {
    fetchFeeds();
  }, []);

  const handleAddFeed = async () => {
    if (!feedName.trim() || !feedUrl.trim()) return;

    setIsAdding(true);
    try {
      await window.electron.news.addFeed(feedName.trim(), feedUrl.trim());
      showSuccessToast(t("news_feed_added"));
      setFeedName("");
      setFeedUrl("");
      setShowAddForm(false);
      await fetchFeeds();
    } catch (error) {
      logger.error("Failed to add RSS feed:", error);
      showErrorToast(t("news_feed_add_failed"));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveFeed = async () => {
    if (!feedToRemove) return;

    try {
      await window.electron.news.removeFeed(feedToRemove.id);
      showSuccessToast(t("news_feed_removed"));
      setFeedToRemove(null);
      await fetchFeeds();
    } catch (error) {
      logger.error("Failed to remove RSS feed:", error);
    }
  };

  return (
    <div className="settings-news-feeds">
      <ConfirmationModal
        visible={!!feedToRemove}
        title={t("confirm_remove_feed")}
        descriptionText={feedToRemove?.name || ""}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel")}
        onConfirm={handleRemoveFeed}
        onClose={() => setFeedToRemove(null)}
      />

      <p className="settings-news-feeds__description">
        {t("news_feeds_description")}
      </p>

      <div className="settings-news-feeds__header">
        <span className="settings-news-feeds__count">
          {feeds.length} {feeds.length === 1 ? "feed" : "feeds"}
        </span>

        <Button
          type="button"
          theme="outline"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          <PlusCircleIcon />
          {t("add_news_feed")}
        </Button>
      </div>

      {showAddForm && (
        <div className="settings-news-feeds__add-form">
          <div className="settings-news-feeds__add-field">
            <label>{t("news_feed_name")}</label>
            <input
              type="text"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              placeholder="PC Gamer"
            />
          </div>
          <div className="settings-news-feeds__add-field">
            <label>{t("news_feed_url")}</label>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://example.com/rss"
            />
          </div>
          <Button
            type="button"
            theme="primary"
            onClick={handleAddFeed}
            disabled={isAdding || !feedName.trim() || !feedUrl.trim()}
          >
            {t("add_news_feed")}
          </Button>
        </div>
      )}

      {feeds.length === 0 ? (
        <div className="settings-news-feeds__empty">
          <LinkIcon size={24} />
          <p>{t("news_feeds_description")}</p>
        </div>
      ) : (
        <ul className="settings-news-feeds__list">
          {feeds.map((feed) => (
            <li key={feed.id} className="settings-news-feeds__item">
              <div className="settings-news-feeds__item-info">
                <span className="settings-news-feeds__item-name">
                  {feed.name}
                </span>
                <span className="settings-news-feeds__item-url">
                  <LinkIcon size={12} />
                  {feed.url}
                </span>
              </div>

              <button
                type="button"
                className="settings-news-feeds__remove-btn"
                onClick={() => setFeedToRemove(feed)}
                title={t("remove")}
              >
                <NoEntryIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
