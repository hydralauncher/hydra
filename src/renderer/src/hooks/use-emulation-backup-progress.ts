import { useEffect, useState } from "react";

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
  const [backingUpCard, setBackingUpCard] = useState<string | null>(null);
  const [backupProgress, setBackupProgress] =
    useState<EmulationBackupProgress | null>(null);

  useEffect(() => {
    let active = true;
    const seenDone = new Set<string>();

    void window.electron.getActiveEmulationBackups().then((list) => {
      if (!active) return;
      const match = list.find((b) => b.platform === platform);
      if (!match || seenDone.has(match.cardFilePath)) return;
      setBackingUpCard(match.cardFilePath);
      setBackupProgress(match);
    });

    const unsubscribe = window.electron.onEmulationBackupProgress((payload) => {
      if (payload.platform !== platform) return;
      if (payload.processed >= payload.total) {
        seenDone.add(payload.cardFilePath);
        setBackingUpCard((prev) =>
          prev === payload.cardFilePath ? null : prev
        );
        setBackupProgress((prev) =>
          prev?.cardFilePath === payload.cardFilePath ? null : prev
        );
        return;
      }
      setBackingUpCard(payload.cardFilePath);
      setBackupProgress(payload);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  return { backingUpCard, backupProgress, setBackingUpCard, setBackupProgress };
}

export function resolveCardBackupProgress(
  backingUpCard: string | null,
  backupProgress: EmulationBackupProgress | null,
  cardFilePath: string,
  recordCount: number
): CardBackupProgress {
  const isBackingUp = backingUpCard === cardFilePath;
  const progress =
    isBackingUp && backupProgress?.cardFilePath === cardFilePath
      ? backupProgress
      : null;
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
