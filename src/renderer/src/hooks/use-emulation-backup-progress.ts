import { useCallback, useEffect, useState } from "react";

import type { EmulationBackupProgress, EmulationSavePlatform } from "@types";

const PERCENT = 100;

export interface CardBackupProgress {
  isBackingUp: boolean;
  total: number;
  done: number;
  label: string | null;
  percent: number;
}

export function useEmulationBackupProgress(platform: EmulationSavePlatform) {
  const [backupProgressByCard, setBackupProgressByCard] = useState<
    Record<string, EmulationBackupProgress>
  >({});

  useEffect(() => {
    let active = true;
    const seenDone = new Set<string>();

    void window.electron.getActiveEmulationBackups().then((list) => {
      if (!active) return;
      const matches = list.filter(
        (b) => b.platform === platform && !seenDone.has(b.cardFilePath)
      );
      if (matches.length === 0) return;
      setBackupProgressByCard((prev) => {
        const next = { ...prev };
        for (const match of matches) next[match.cardFilePath] = match;
        return next;
      });
    });

    const unsubscribe = window.electron.onEmulationBackupProgress((payload) => {
      if (payload.platform !== platform) return;
      if (payload.processed >= payload.total) {
        seenDone.add(payload.cardFilePath);
        setBackupProgressByCard((prev) => {
          if (!(payload.cardFilePath in prev)) return prev;
          const next = { ...prev };
          delete next[payload.cardFilePath];
          return next;
        });
        return;
      }
      setBackupProgressByCard((prev) => ({
        ...prev,
        [payload.cardFilePath]: payload,
      }));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  const markCardBackupStarted = useCallback(
    (cardFilePath: string, total: number) => {
      setBackupProgressByCard((prev) => ({
        ...prev,
        [cardFilePath]: {
          platform,
          cardFilePath,
          processed: 0,
          uploaded: 0,
          failed: 0,
          total,
          currentLabel: null,
        },
      }));
    },
    [platform]
  );

  const markCardBackupFinished = useCallback((cardFilePath: string) => {
    setBackupProgressByCard((prev) => {
      if (!(cardFilePath in prev)) return prev;
      const next = { ...prev };
      delete next[cardFilePath];
      return next;
    });
  }, []);

  const backupCard = useCallback(
    async (cardFilePath: string, recordCount: number) => {
      markCardBackupStarted(cardFilePath, recordCount);
      try {
        return await window.electron.uploadEmulationSavesForCard(
          platform,
          cardFilePath
        );
      } catch {
        return null;
      } finally {
        markCardBackupFinished(cardFilePath);
      }
    },
    [platform, markCardBackupStarted, markCardBackupFinished]
  );

  return {
    backupProgressByCard,
    backupCard,
  };
}

export function resolveCardBackupProgress(
  backupProgressByCard: Record<string, EmulationBackupProgress>,
  cardFilePath: string,
  recordCount: number
): CardBackupProgress {
  const progress = backupProgressByCard[cardFilePath] ?? null;
  const isBackingUp = progress !== null;
  const total = progress?.total ?? recordCount;
  const done = progress?.processed ?? 0;
  const percent =
    total > 0 ? Math.min(PERCENT, Math.round((done / total) * PERCENT)) : 0;

  return {
    isBackingUp,
    total,
    done,
    label: progress?.currentLabel ?? null,
    percent,
  };
}
