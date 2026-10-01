const touchedGameKeys = new Set<string>();
let isBatchActive = false;

export const setAchievementBatchActive = (active: boolean) => {
  isBatchActive = active;
};

export const trackAchievementBatchGame = (gameKey: string) => {
  if (isBatchActive) touchedGameKeys.add(gameKey);
};

export const hasTouchedAchievementBatchGames = () => touchedGameKeys.size > 0;

export const takeTouchedAchievementBatchGames = () => {
  const gameKeys = new Set(touchedGameKeys);
  touchedGameKeys.clear();
  return gameKeys;
};
