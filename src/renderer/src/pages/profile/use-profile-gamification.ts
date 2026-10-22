import { useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useGamificationProgress } from "@renderer/hooks";

export function useProfileGamification() {
  const { userProfile, isMe } = useContext(userProfileContext);
  const { progress } = useGamificationProgress();

  if (isMe && progress) {
    return {
      level: {
        level: progress.level,
        xp: progress.xp,
        xpToNextLevel: progress.xpToNextLevel,
      },
      loginStreak: progress.loginStreak,
      coins: progress.coins,
    };
  }

  return {
    level: userProfile?.progress ?? null,
    loginStreak: userProfile?.loginStreak ?? null,
    coins: null,
  };
}
