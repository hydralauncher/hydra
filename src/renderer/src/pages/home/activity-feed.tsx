import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";

import { Avatar } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate } from "@renderer/hooks";
import type { GameShop, UserDetails, UserFriends, UserProfile } from "@types";

import "./activity-feed.scss";

interface UserReview {
  id: string;
  score: number;
  createdAt: string;
  game: {
    title: string;
    iconUrl: string;
    objectId: string;
    shop: GameShop;
  };
}

interface UserReviewsResponse {
  totalCount: number;
  reviews: UserReview[];
}

type ActivityItemType = "playing_now" | "recently_played" | "review";

interface ActivityItem {
  id: string;
  type: ActivityItemType;
  friend: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
  game: {
    objectId: string;
    shop: GameShop;
    title: string;
    iconUrl: string | null;
  };
  timestamp: Date | null;
  reviewScore?: number;
  playTimeInSeconds?: number;
  sessionDurationInSeconds?: number;
}

interface ActivityFeedProps {
  userDetails: UserDetails;
}

export function ActivityFeed({ userDetails }: ActivityFeedProps) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { formatDistance } = useDate();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    setIsLoading(true);

    try {
      const friendsData = await window.electron.hydraApi.get<UserFriends>(
        "/profile/friends",
        { params: { take: 12, skip: 0 } }
      );

      const friends = friendsData.friends;
      if (friends.length === 0) {
        setItems([]);
        return;
      }

      const playingNowItems: ActivityItem[] = friends
        .filter((f) => f.currentGame)
        .map((f) => ({
          id: `playing-${f.id}`,
          type: "playing_now" as const,
          friend: {
            id: f.id,
            displayName: f.displayName,
            profileImageUrl: f.profileImageUrl,
          },
          game: {
            objectId: f.currentGame!.objectId,
            shop: f.currentGame!.shop,
            title: f.currentGame!.title,
            iconUrl: f.currentGame!.iconUrl,
          },
          timestamp: new Date(),
          sessionDurationInSeconds: f.currentGame!.sessionDurationInSeconds,
        }));

      const profilePromises = friends.map((friend) =>
        window.electron.hydraApi
          .get<UserProfile>(`/users/${friend.id}`, { needsAuth: true })
          .catch(() => null)
      );

      const reviewPromises = friends.map((friend) =>
        window.electron.hydraApi
          .get<UserReviewsResponse>(`/users/${friend.id}/reviews`, {
            needsAuth: true,
          })
          .catch(() => null)
      );

      const [profileResults, reviewResults] = await Promise.all([
        Promise.all(profilePromises),
        Promise.all(reviewPromises),
      ]);

      const recentlyPlayedItems: ActivityItem[] = [];
      for (let i = 0; i < friends.length; i++) {
        const profile = profileResults[i];
        if (!profile?.recentGames) continue;

        for (const game of profile.recentGames.slice(0, 3)) {
          if (friends[i].currentGame?.objectId === game.objectId) {
            continue;
          }

          recentlyPlayedItems.push({
            id: `played-${friends[i].id}-${game.objectId}`,
            type: "recently_played",
            friend: {
              id: friends[i].id,
              displayName: friends[i].displayName,
              profileImageUrl: friends[i].profileImageUrl,
            },
            game: {
              objectId: game.objectId,
              shop: game.shop,
              title: game.title,
              iconUrl: game.iconUrl,
            },
            timestamp: game.lastTimePlayed
              ? new Date(game.lastTimePlayed)
              : null,
            playTimeInSeconds: game.playTimeInSeconds,
          });
        }
      }

      const reviewItems: ActivityItem[] = [];
      for (let i = 0; i < friends.length; i++) {
        const reviewsData = reviewResults[i];
        if (!reviewsData?.reviews) continue;

        for (const review of reviewsData.reviews.slice(0, 3)) {
          reviewItems.push({
            id: `review-${friends[i].id}-${review.id}`,
            type: "review",
            friend: {
              id: friends[i].id,
              displayName: friends[i].displayName,
              profileImageUrl: friends[i].profileImageUrl,
            },
            game: {
              objectId: review.game.objectId,
              shop: review.game.shop,
              title: review.game.title,
              iconUrl: review.game.iconUrl,
            },
            timestamp: new Date(review.createdAt),
            reviewScore: review.score,
          });
        }
      }

      const allItems = [
        ...playingNowItems,
        ...recentlyPlayedItems,
        ...reviewItems,
      ].sort((a, b) => {
        if (a.type === "playing_now" && b.type !== "playing_now") return -1;
        if (a.type !== "playing_now" && b.type === "playing_now") return 1;

        const timeA = a.timestamp?.getTime() ?? 0;
        const timeB = b.timestamp?.getTime() ?? 0;
        return timeB - timeA;
      });

      setItems(allItems.slice(0, 20));
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userDetails) {
      fetchFeed();
    }
  }, [userDetails, fetchFeed]);

  const formatSessionDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatPlayTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    if (hours < 1) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m`;
    }
    return `${hours}h`;
  };

  const handleGameClick = (item: ActivityItem) => {
    navigate(
      buildGameDetailsPath({
        objectId: item.game.objectId,
        shop: item.game.shop,
        title: item.game.title,
      })
    );
  };

  const handleFriendClick = (e: React.MouseEvent, friendId: string) => {
    e.stopPropagation();
    navigate(`/profile/${friendId}`);
  };

  const renderActivityText = (item: ActivityItem) => {
    switch (item.type) {
      case "playing_now":
        return (
          <span className="activity-feed__item-text">
            <span className="activity-feed__action activity-feed__action--playing">
              {t("friend_playing_now")}
            </span>{" "}
            <span className="activity-feed__game-title">{item.game.title}</span>
            {item.sessionDurationInSeconds != null &&
              item.sessionDurationInSeconds > 0 && (
                <span className="activity-feed__duration">
                  {" "}
                  ({formatSessionDuration(item.sessionDurationInSeconds)})
                </span>
              )}
          </span>
        );
      case "recently_played":
        return (
          <span className="activity-feed__item-text">
            <span className="activity-feed__action">
              {t("friend_recently_played")}
            </span>{" "}
            <span className="activity-feed__game-title">{item.game.title}</span>
            {item.playTimeInSeconds != null && item.playTimeInSeconds > 0 && (
              <span className="activity-feed__duration">
                {" "}
                ({formatPlayTime(item.playTimeInSeconds)})
              </span>
            )}
          </span>
        );
      case "review":
        return (
          <span className="activity-feed__item-text">
            <span className="activity-feed__action">
              {t("friend_reviewed")}
            </span>{" "}
            <span className="activity-feed__game-title">{item.game.title}</span>
            {item.reviewScore != null && (
              <span className="activity-feed__score">
                {" "}
                ({t("review_score", { score: item.reviewScore })})
              </span>
            )}
          </span>
        );
    }
  };

  const skeletonItems = useMemo(
    () => Array.from({ length: 5 }, (_, i) => i),
    []
  );

  if (isLoading) {
    return (
      <div className="activity-feed">
        <h3 className="activity-feed__title">{t("activity_feed")}</h3>
        <div className="activity-feed__list">
          {skeletonItems.map((i) => (
            <div key={i} className="activity-feed__item-skeleton">
              <Skeleton circle width={36} height={36} />
              <div className="activity-feed__skeleton-text">
                <Skeleton width="70%" height={14} />
                <Skeleton width="40%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="activity-feed">
        <h3 className="activity-feed__title">{t("activity_feed")}</h3>
        <p className="activity-feed__empty">{t("no_recent_activity")}</p>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      <h3 className="activity-feed__title">{t("activity_feed")}</h3>
      <div className="activity-feed__list">
        {items.map((item) => (
          <button
            key={item.id}
            className="activity-feed__item"
            onClick={() => handleGameClick(item)}
          >
            <button
              className="activity-feed__avatar-wrapper"
              onClick={(e) => handleFriendClick(e, item.friend.id)}
            >
              <Avatar
                size={36}
                src={item.friend.profileImageUrl}
                alt={item.friend.displayName}
              />
              {item.type === "playing_now" && (
                <span className="activity-feed__online-indicator" />
              )}
            </button>

            <div className="activity-feed__item-content">
              <button
                className="activity-feed__friend-name"
                onClick={(e) => handleFriendClick(e, item.friend.id)}
              >
                {item.friend.displayName}
              </button>
              {renderActivityText(item)}
              {item.timestamp && item.type !== "playing_now" && (
                <span className="activity-feed__time-ago">
                  {formatDistance(item.timestamp, new Date(), {
                    addSuffix: true,
                  })}
                </span>
              )}
            </div>

            {item.game.iconUrl && (
              <img
                src={item.game.iconUrl}
                alt={item.game.title}
                className="activity-feed__game-icon"
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
