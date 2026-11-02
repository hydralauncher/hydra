import type {
  AchievementNotificationInfo,
  Game,
  SteamAchievement,
  UserPreferences,
} from "@types";
import { WindowManager } from "../window-manager";
import { publishNewAchievementNotification } from "../notifications";
import { achievementsLogger } from "../logger";
import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";

const RARE_ACHIEVEMENT_MAX_UNLOCK_PERCENTAGE = 10;

const isRareAchievement = (points: number) => {
  const rawPercentage = (50 - Math.sqrt(points)) * 2;

  return rawPercentage < RARE_ACHIEVEMENT_MAX_UNLOCK_PERCENTAGE;
};

export interface AchievementUnlockNotificationOptions {
  game: Game;
  achievements: SteamAchievement[];
  completesGame: boolean;
  unlockedAchievementCount: number;
  totalAchievementCount: number;
  userPreferences: UserPreferences | null;
}

export const buildAchievementNotificationInfo = (
  achievements: SteamAchievement[],
  completesGame: boolean
): AchievementNotificationInfo[] =>
  achievements.map((achievement, index) => ({
    title: achievement.displayName,
    description: achievement.description,
    points: achievement.points,
    isHidden: achievement.hidden,
    isRare: achievement.points ? isRareAchievement(achievement.points) : false,
    isPlatinum: completesGame && index === achievements.length - 1,
    iconUrl: achievement.icon,
  }));

export const publishAchievementUnlockNotifications = ({
  game,
  achievements,
  completesGame,
  unlockedAchievementCount,
  totalAchievementCount,
  userPreferences,
}: AchievementUnlockNotificationOptions) => {
  if (
    !achievements.length ||
    userPreferences?.achievementNotificationsEnabled === false
  ) {
    return;
  }

  const achievementsInfo = buildAchievementNotificationInfo(
    achievements,
    completesGame
  );

  achievementsLogger.log(
    "Publishing achievement notification",
    game.objectId,
    game.title
  );

  const customNotificationsOnly =
    userPreferences?.achievementCustomNotificationsEnabled !== false &&
    process.platform !== "darwin";

  const position =
    userPreferences?.achievementCustomNotificationPosition ?? "top-left";

  const publishOsNotification = () =>
    publishNewAchievementNotification({
      achievements: achievementsInfo,
      unlockedAchievementCount,
      totalAchievementCount,
      gameTitle: game.title,
      gameIcon: game.iconUrl,
    });

  if (process.platform === "linux") {
    const shownInApp =
      customNotificationsOnly &&
      WindowManager.sendAchievementToFocusedWindow(position, achievementsInfo);

    if (!shownInApp) {
      void publishOsNotification();
    }
  } else if (customNotificationsOnly) {
    achievementNotificationPresenter.enqueueAchievements(
      position,
      achievementsInfo
    );
  } else {
    void publishOsNotification();
  }
};
