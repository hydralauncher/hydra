import { useCallback, useState } from "react";
import { toggleSetKey } from "./achievement-list";

export function useCollapsedAchievementSets() {
  const [collapsedSetKeys, setCollapsedSetKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const toggleSet = useCallback((key: string) => {
    setCollapsedSetKeys((current) => toggleSetKey(current, key));
  }, []);

  return { collapsedSetKeys, toggleSet };
}

export function useRevealedAchievements() {
  const [revealedNames, setRevealedNames] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [lastRevealedName, setLastRevealedName] = useState<string | null>(null);

  const revealAchievement = useCallback((name: string) => {
    setRevealedNames((current) => new Set(current).add(name));
    setLastRevealedName(name);
  }, []);

  return { revealedNames, lastRevealedName, revealAchievement };
}
