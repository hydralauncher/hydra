export const LEADERBOARD_RANK_CHANGED_NOTIFICATION = "LEADERBOARD_RANK_CHANGED";
export const LEADERBOARD_MISSING_PHOTO_NOTIFICATION =
  "LEADERBOARD_MISSING_PHOTO";

export const LEADERBOARD_REQUEST_SOURCES = ["rank_notification"] as const;
export type LeaderboardRequestSource =
  (typeof LEADERBOARD_REQUEST_SOURCES)[number];

export type LeaderboardRankMoment = "leader" | "top3" | "top100";

export interface LeaderboardNotificationInfo {
  kind: "rank" | "missing_photo";
  metric: string;
  scope: "global" | "friends";
  game: { shop: string; objectId: string; title: string } | null;
  rank: number;
  previousRank: number | null;
  direction: "up" | "down";
  moment: LeaderboardRankMoment | null;
  cloudRank: number | null;
  push: boolean;
}

interface NotificationLike {
  type: string;
  variables: Record<string, unknown> | null;
}

const MOMENTS: readonly LeaderboardRankMoment[] = ["leader", "top3", "top100"];

const toRank = (value: unknown) => {
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
};

const toText = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

export const parseLeaderboardNotification = (
  notification: NotificationLike
): LeaderboardNotificationInfo | null => {
  const isRank = notification.type === LEADERBOARD_RANK_CHANGED_NOTIFICATION;
  const isMissingPhoto =
    notification.type === LEADERBOARD_MISSING_PHOTO_NOTIFICATION;
  if ((!isRank && !isMissingPhoto) || !notification.variables) return null;

  const variables = notification.variables;
  const metric = toText(variables.metric);
  const rank = toRank(isRank ? variables.newRank : variables.missingPhotoRank);
  if (!metric || !rank) return null;

  const shop = toText(variables.shop);
  const objectId = toText(variables.objectId);
  const moment = MOMENTS.find((known) => known === variables.moment) ?? null;

  return {
    kind: isRank ? "rank" : "missing_photo",
    metric,
    scope: isRank && variables.scope === "friends" ? "friends" : "global",
    game:
      variables.boardType === "game" && shop && objectId
        ? { shop, objectId, title: toText(variables.gameTitle) ?? "" }
        : null,
    rank,
    previousRank: isRank ? toRank(variables.previousRank) : null,
    direction: isRank && variables.direction === "down" ? "down" : "up",
    moment,
    cloudRank: isRank ? toRank(variables.cloudRank) : null,
    push: variables.push === true || variables.push === "true",
  };
};

export const getLeaderboardRankDelta = (info: LeaderboardNotificationInfo) =>
  info.previousRank === null ? null : Math.abs(info.previousRank - info.rank);

export const isLeaderboardSourceParam = (
  value: string | null
): value is LeaderboardRequestSource =>
  (LEADERBOARD_REQUEST_SOURCES as readonly (string | null)[]).includes(value);

export const buildLeaderboardBoardPath = (
  metric: string,
  game: { shop: string; objectId: string } | null
) =>
  game
    ? `/games/${game.shop}/${encodeURIComponent(game.objectId)}/leaderboards/${encodeURIComponent(metric)}`
    : `/leaderboards/${encodeURIComponent(metric)}`;

type Translate = (key: string, options?: Record<string, unknown>) => string;

const NOTIFICATIONS_NS = "notifications_page";

export const buildLeaderboardBoardLabel = (
  t: Translate,
  info: LeaderboardNotificationInfo
) => {
  const metric = t(`metric_${info.metric}`, {
    ns: "leaderboards",
    defaultValue: info.metric,
  });
  if (info.game) {
    return t("leaderboard_board_game", {
      ns: NOTIFICATIONS_NS,
      metric,
      game: info.game.title,
    });
  }
  return t(`leaderboard_board_${info.scope}`, { ns: NOTIFICATIONS_NS, metric });
};

const titleKey = (info: LeaderboardNotificationInfo) => {
  if (info.kind === "missing_photo") return "leaderboard_missing_photo_title";
  if (info.moment === "leader" && info.scope === "friends")
    return "leaderboard_leader_friends_title";
  if (info.moment) return `leaderboard_${info.moment}_title`;
  return info.direction === "up"
    ? "leaderboard_up_title"
    : "leaderboard_down_title";
};

export const buildLeaderboardNotificationText = (
  t: Translate,
  info: LeaderboardNotificationInfo
) => {
  const board = buildLeaderboardBoardLabel(t, info);
  const options = { ns: NOTIFICATIONS_NS, rank: info.rank, board };
  const title = t(titleKey(info), { ns: NOTIFICATIONS_NS });

  if (info.kind === "missing_photo") {
    return {
      title,
      description: t("leaderboard_missing_photo_description", options),
    };
  }

  const description = t(
    info.direction === "down"
      ? "leaderboard_down_description"
      : "leaderboard_rank_description",
    options
  );
  return {
    title,
    description:
      info.cloudRank === null
        ? description
        : `${description} ${t("leaderboard_cloud_rank", { ns: NOTIFICATIONS_NS, rank: info.cloudRank })}`,
  };
};

export const EDIT_PROFILE_SEARCH_PARAM = "edit";
export const EDIT_PROFILE_SEARCH_VALUE = "profile";

export const buildLeaderboardNotificationTarget = (
  url: string | null,
  info: LeaderboardNotificationInfo,
  userId: string | null
) =>
  info.kind === "missing_photo" && userId
    ? `/profile/${userId}?${EDIT_PROFILE_SEARCH_PARAM}=${EDIT_PROFILE_SEARCH_VALUE}`
    : url;
