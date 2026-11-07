import { useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useAppSelector, useGamificationProgress } from "@renderer/hooks";

export function useProfileGamification() {
  const { userProfile, isMe } = useContext(userProfileContext);
  const { progress } = useGamificationProgress();
  const isEnabled = useAppSelector((state) => state.gamification.isEnabled);

  if (!isEnabled) {
    return { level: null, loginStreak: null, coins: null, isMe };
  }

  if (isMe && progress) {
    return {
      level: {
        level: progress.level,
        xp: progress.xp,
        xpToNextLevel: progress.xpToNextLevel,
      },
      loginStreak: progress.loginStreak,
      coins: progress.coins,
      isMe,
    };
  }

  return {
    level: userProfile?.progress ?? null,
    loginStreak: userProfile?.loginStreak ?? null,
    coins: null,
    isMe,
  };
}
