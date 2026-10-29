import { useCallback, useMemo } from "react";
import {
  XIcon,
  PersonIcon,
  ClockIcon,
  StarFillIcon,
  HeartFillIcon,
  CommentDiscussionIcon,
  GiftIcon,
  ThumbsupIcon,
} from "@primer/octicons-react";
import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components";
import { useDate, useUserDetails } from "@renderer/hooks";
import cn from "classnames";
import {
  buildLeaderboardNotificationTarget,
  buildLeaderboardNotificationText,
  buildScreenshotNotificationTarget,
  buildSouvenirNotificationTarget,
  isScreenshotNotificationType,
  parseLeaderboardNotification,
} from "@shared";
import {
  LeaderboardNotificationIcon,
  LeaderboardRankChip,
} from "@renderer/components/leaderboard-notification/leaderboard-notification-icon";

import type { Notification, Badge } from "@types";
import { openCloudGiftModal } from "../shared-modals/cloud-gift-modal.events";
import "./notification-item.scss";

const PROFILE_DEEP_LINK_PARAMS = ["tab", "souvenir", "screenshot"];

const buildProfileTarget = (userId: string, searchParams: URLSearchParams) => {
  const params = new URLSearchParams();
  for (const key of PROFILE_DEEP_LINK_PARAMS) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }

  const queryString = params.toString();
  return queryString
    ? `/profile/${userId}?${queryString}`
    : `/profile/${userId}`;
};

const parseNotificationUrl = (notificationUrl: string): string => {
  const url = new URL(notificationUrl, "http://localhost");
  const userId = url.searchParams.get("userId");
  const badgeName = url.searchParams.get("name");
  const gameTitle = url.searchParams.get("title");
  const showReviews = url.searchParams.get("reviews");
  const reviewId = url.searchParams.get("reviewId");

  if (url.pathname === "/profile" && userId) {
    return buildProfileTarget(userId, url.searchParams);
  }

  if (url.pathname === "/badges" && badgeName) {
    return `/badges/${badgeName}`;
  }

  if (
    url.pathname === "/profile/integrations/retroachievements" ||
    url.pathname === "/profile/integrations/steam"
  ) {
    return "/settings?tab=integrations";
  }

  if (url.pathname.startsWith("/game/")) {
    const params = new URLSearchParams();
    if (gameTitle) params.set("title", gameTitle);
    if (showReviews) params.set("reviews", showReviews);
    if (reviewId) params.set("reviewId", reviewId);
    const queryString = params.toString();
    return queryString ? `${url.pathname}?${queryString}` : url.pathname;
  }

  return notificationUrl;
};

const getNotificationUrl = (notification: Notification) => {
  if (notification.url) return notification.url;
  if (!isScreenshotNotificationType(notification.type)) return null;

  const ownerId = notification.variables.ownerId;
  return ownerId ? `/profile/${encodeURIComponent(ownerId)}` : null;
};

const getNotificationTarget = (notification: Notification) => {
  const url = getNotificationUrl(notification);
  if (!url) return null;

  const target = parseNotificationUrl(url);

  if (notification.type === "SOUVENIR_LIKE") {
    return buildSouvenirNotificationTarget(target, notification.variables);
  }

  if (isScreenshotNotificationType(notification.type)) {
    return buildScreenshotNotificationTarget(target, notification.variables);
  }

  return target;
};

interface NotificationItemProps {
  notification: Notification;
  badges: Badge[];
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onAcceptFriendRequest?: (senderId: string) => void;
  onRefuseFriendRequest?: (senderId: string) => void;
}

export function NotificationItem({
  notification,
  badges,
  onDismiss,
  onMarkAsRead,
  onAcceptFriendRequest,
  onRefuseFriendRequest,
}: Readonly<NotificationItemProps>) {
  const { t } = useTranslation("notifications_page");
  const { formatDistance } = useDate();
  const navigate = useNavigate();
  const { updateFriendRequestState, userDetails } = useUserDetails();

  const leaderboardInfo = useMemo(
    () => parseLeaderboardNotification(notification),
    [notification]
  );

  const badge = useMemo(() => {
    if (notification.type !== "BADGE_RECEIVED") return null;
    return badges.find((b) => b.name === notification.variables.badgeName);
  }, [notification, badges]);

  const handleClick = useCallback(() => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }

    if (
      notification.type === "CLOUD_GIFT_RECEIVED" &&
      notification.variables.giftId
    ) {
      openCloudGiftModal(notification);
      return;
    }

    const target = leaderboardInfo
      ? buildLeaderboardNotificationTarget(
          notification.url,
          leaderboardInfo,
          userDetails?.id ?? null
        )
      : getNotificationTarget(notification);
    if (target) navigate(target);
  }, [notification, onMarkAsRead, navigate, leaderboardInfo, userDetails?.id]);

  const handleAccept = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const senderId = notification.variables.senderId;
      if (senderId) {
        await updateFriendRequestState(senderId, "ACCEPTED");
        onAcceptFriendRequest?.(senderId);
        onDismiss(notification.id);
      }
    },
    [notification, updateFriendRequestState, onAcceptFriendRequest, onDismiss]
  );

  const handleRefuse = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const senderId = notification.variables.senderId;
      if (senderId) {
        await updateFriendRequestState(senderId, "REFUSED");
        onRefuseFriendRequest?.(senderId);
        onDismiss(notification.id);
      }
    },
    [notification, updateFriendRequestState, onRefuseFriendRequest, onDismiss]
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss]
  );

  const screenshotGameTitle =
    notification.variables.gameTitle ||
    notification.variables.customGameTitle ||
    t("screenshot_custom_game");

  const getNotificationContent = () => {
    if (leaderboardInfo) {
      return {
        ...buildLeaderboardNotificationText(t, leaderboardInfo),
        showActions: false,
      };
    }

    switch (notification.type) {
      case "FRIEND_REQUEST_RECEIVED":
        return {
          title: t("friend_request_received_title"),
          description: t("friend_request_received_description", {
            displayName: notification.variables.senderDisplayName,
          }),
          showActions: true,
        };
      case "FRIEND_REQUEST_ACCEPTED":
        return {
          title: t("friend_request_accepted_title"),
          description: t("friend_request_accepted_description", {
            displayName: notification.variables.accepterDisplayName,
          }),
          showActions: false,
        };
      case "BADGE_RECEIVED":
        return {
          title: t("badge_received_title"),
          description: badge?.description || notification.variables.badgeName,
          showActions: false,
        };
      case "REVIEW_UPVOTE":
        return {
          title: t("review_upvote_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_upvote_description", {
            count: Number.parseInt(
              notification.variables.upvoteCount || "1",
              10
            ),
          }),
          showActions: false,
        };
      case "REVIEW_ANSWER":
        return {
          title: t("review_answer_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_answer_description", {
            displayName: notification.variables.answerAuthorDisplayName,
          }),
          showActions: false,
        };
      case "REVIEW_ANSWER_UPVOTE":
        return {
          title: t("review_answer_upvote_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_answer_upvote_description", {
            count: Number.parseInt(
              notification.variables.upvoteCount || "1",
              10
            ),
          }),
          showActions: false,
        };
      case "SOUVENIR_LIKE":
        return {
          title: t("souvenir_like_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("souvenir_like_description", {
            count: Number(notification.variables.likeCount ?? 1),
          }),
          showActions: false,
        };
      case "SCREENSHOT_LIKE":
        return {
          title: t("screenshot_like_title", { gameTitle: screenshotGameTitle }),
          description: t("screenshot_like_description", {
            count: Number(notification.variables.likeCount ?? 1),
          }),
          showActions: false,
        };
      case "SCREENSHOT_COMMENT":
        return {
          title: t("screenshot_comment_title", {
            gameTitle: screenshotGameTitle,
          }),
          description: t("screenshot_comment_description", {
            gameTitle: screenshotGameTitle,
            count: Number(notification.variables.commentCount ?? 1),
          }),
          showActions: false,
        };
      case "SCREENSHOT_COMMENT_UPVOTE":
        return {
          title: t("screenshot_comment_upvote_title", {
            gameTitle: screenshotGameTitle,
          }),
          description: t("screenshot_comment_upvote_description", {
            count: Number(notification.variables.upvoteCount ?? 1),
          }),
          showActions: false,
        };
      case "RETROACHIEVEMENTS_CREDENTIALS_RESTORED":
        return {
          title: t("retroachievements_credentials_restored_title"),
          description: t("retroachievements_credentials_restored_description"),
          showActions: false,
        };
      case "RETROACHIEVEMENTS_CREDENTIALS_INVALID":
        return {
          title: t("retroachievements_credentials_invalid_title"),
          description: t("retroachievements_credentials_invalid_description"),
          showActions: false,
        };
      case "RETROACHIEVEMENTS_SYNC_FAILED":
        return {
          title: t("retroachievements_sync_failed_title"),
          description: t("retroachievements_sync_failed_description", {
            gameTitle: notification.variables.gameTitle,
          }),
          showActions: false,
        };
      case "CLOUD_GIFT_RECEIVED": {
        const durationMonths = Number(notification.variables.durationMonths);

        return {
          title: Number.isFinite(durationMonths)
            ? t("cloud_gift_received_title", { count: durationMonths })
            : t("cloud_gift_received_title"),
          description: t("cloud_gift_received_description", {
            displayName: notification.variables.buyerDisplayName,
          }),
          showActions: false,
        };
      }
      default:
        return {
          title: t("notification"),
          description: "",
          showActions: false,
        };
    }
  };

  const content = getNotificationContent();
  const isBadge = notification.type === "BADGE_RECEIVED";
  const isReviewUpvote = notification.type === "REVIEW_UPVOTE";
  const isReviewAnswer = notification.type === "REVIEW_ANSWER";
  const isReviewAnswerUpvote = notification.type === "REVIEW_ANSWER_UPVOTE";
  const isReview = isReviewUpvote || isReviewAnswer || isReviewAnswerUpvote;
  const isSouvenirLike = notification.type === "SOUVENIR_LIKE";
  const isScreenshotLike = notification.type === "SCREENSHOT_LIKE";
  const isScreenshotComment = notification.type === "SCREENSHOT_COMMENT";
  const isScreenshotCommentUpvote =
    notification.type === "SCREENSHOT_COMMENT_UPVOTE";

  const isRetroAchievements =
    notification.type === "RETROACHIEVEMENTS_CREDENTIALS_RESTORED" ||
    notification.type === "RETROACHIEVEMENTS_CREDENTIALS_INVALID" ||
    notification.type === "RETROACHIEVEMENTS_SYNC_FAILED";

  const getIcon = () => {
    if (notification.pictureUrl) {
      return <img src={notification.pictureUrl} alt="" />;
    }
    if (isRetroAchievements) {
      return <img src={retroAchievementsLogo} alt="" />;
    }
    if (isReviewUpvote || isReviewAnswerUpvote) {
      return <StarFillIcon size={24} />;
    }
    if (isScreenshotCommentUpvote) {
      return <ThumbsupIcon size={24} />;
    }
    if (isReviewAnswer || isScreenshotComment) {
      return <CommentDiscussionIcon size={24} />;
    }
    if (notification.type === "CLOUD_GIFT_RECEIVED") {
      return <GiftIcon size={24} />;
    }
    if (isSouvenirLike || isScreenshotLike) {
      return <HeartFillIcon size={24} />;
    }
    return <PersonIcon size={24} />;
  };

  return (
    <button
      type="button"
      className={cn("notification-item", {
        "notification-item--unread":
          !notification.isRead ||
          notification.type === "FRIEND_REQUEST_RECEIVED",
      })}
      onClick={handleClick}
    >
      {leaderboardInfo ? (
        <LeaderboardNotificationIcon info={leaderboardInfo} />
      ) : (
        <div
          className={cn("notification-item__picture", {
            "notification-item__badge-picture": isBadge,
            "notification-item__review-picture": isReview,
            "notification-item__ra-picture": isRetroAchievements,
          })}
        >
          {getIcon()}
        </div>
      )}

      <div className="notification-item__content">
        <span className="notification-item__title">{content.title}</span>
        <span className="notification-item__description">
          {content.description}
        </span>
        <span className="notification-item__time">
          <ClockIcon size={12} />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      {leaderboardInfo && <LeaderboardRankChip info={leaderboardInfo} />}

      {content.showActions &&
        notification.type === "FRIEND_REQUEST_RECEIVED" && (
          <div className="notification-item__actions">
            <Button theme="primary" onClick={handleAccept}>
              {t("accept")}
            </Button>
            <Button theme="outline" onClick={handleRefuse}>
              {t("refuse")}
            </Button>
          </div>
        )}

      {notification.type !== "FRIEND_REQUEST_RECEIVED" && (
        <button
          type="button"
          className="notification-item__dismiss"
          onClick={handleDismiss}
          title={t("dismiss")}
        >
          <XIcon size={16} />
        </button>
      )}
    </button>
  );
}
