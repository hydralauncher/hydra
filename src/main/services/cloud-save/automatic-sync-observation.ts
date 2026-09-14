import { createHash } from "node:crypto";

import type { GameShop } from "@types";

import type { analyzeCloudSaveState } from "./analyze-cloud-save-state.js";

type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;
type AutomaticSyncAttemptStatus = "in-flight" | "settled" | "failed";

interface AutomaticSyncAttempt {
  observationKey: string;
  status: AutomaticSyncAttemptStatus;
  updatedAt: number;
}

const FAILURE_RETRY_DELAY_MS = 30_000;
const latestObservations = new Map<string, string>();
const attempts = new Map<string, AutomaticSyncAttempt>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);
const attemptKey = (objectId: string, shop: GameShop, trigger: string) =>
  JSON.stringify([shop, objectId, trigger]);
const byJson = (left: unknown, right: unknown) =>
  JSON.stringify(left).localeCompare(JSON.stringify(right));
const byText = (left: string, right: string) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const invalidateSettledGamePageAttemptOnObservationChange = (
  objectId: string,
  shop: GameShop,
  previousObservationKey: string | undefined,
  observationKey: string
) => {
  if (
    previousObservationKey !== undefined &&
    previousObservationKey !== observationKey
  ) {
    attempts.delete(attemptKey(objectId, shop, "game-page-open"));
  }
};

export const buildCloudSaveObservationKey = (analysis: CloudSaveAnalysis) => {
  const payload = {
    environmentId: analysis.environmentId,
    manifestKey: analysis.localSnapshot.manifestKey ?? null,
    ruleSourceRevision: analysis.localSnapshot.ruleSourceRevision,
    discoveryEngineVersion: analysis.localSnapshot.discoveryEngineVersion,
    localAggregateHash: analysis.localSnapshot.aggregateHash,
    remote: analysis.activeRemoteSnapshot
      ? {
          id: analysis.activeRemoteSnapshot.id,
          version: analysis.activeRemoteSnapshot.version,
          aggregateHash: analysis.activeRemoteSnapshot.aggregateHash,
        }
      : null,
    anchor: analysis.anchor
      ? {
          baseSnapshotId: analysis.anchor.baseSnapshotId,
          baseVersion: analysis.anchor.baseVersion,
          baseAggregateHash: analysis.anchor.baseAggregateHash,
          unresolvedRemoteEntryIds: [
            ...analysis.anchor.unresolvedRemoteEntryIds,
          ].sort(byText),
        }
      : null,
    bindings: {
      ready: [...analysis.customPathBindings.ready].sort(byJson),
      unresolved: [...analysis.customPathBindings.unresolved].sort(byJson),
      customPathRawPaths: [...analysis.mergedCustomPathRawPaths].sort(byText),
    },
    coverage: [...analysis.localSnapshot.coverage]
      .map((item) => ({
        ...item,
        warningCodes: [...item.warningCodes].sort(byText),
      }))
      .sort(byJson),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

export const recordLatestCloudSaveObservation = (
  objectId: string,
  shop: GameShop,
  observationKey: string
) => {
  const key = gameKey(objectId, shop);
  const previousObservationKey = latestObservations.get(key);
  latestObservations.set(key, observationKey);
  invalidateSettledGamePageAttemptOnObservationChange(
    objectId,
    shop,
    previousObservationKey,
    observationKey
  );
};

export const beginAutomaticSyncObservation = (
  objectId: string,
  shop: GameShop,
  trigger: string,
  now = Date.now()
) => {
  const observationKey = latestObservations.get(gameKey(objectId, shop));
  if (!observationKey) return { accepted: true, observationKey: null } as const;

  const key = attemptKey(objectId, shop, trigger);
  const previous = attempts.get(key);
  const canRetryFailure =
    previous?.status === "failed" &&
    now - previous.updatedAt >= FAILURE_RETRY_DELAY_MS;
  if (
    previous?.observationKey === observationKey &&
    previous.status !== "failed"
  ) {
    return { accepted: false, observationKey } as const;
  }
  if (previous?.observationKey === observationKey && !canRetryFailure) {
    return { accepted: false, observationKey } as const;
  }

  attempts.set(key, { observationKey, status: "in-flight", updatedAt: now });
  return { accepted: true, observationKey } as const;
};

export const finishAutomaticSyncObservation = (
  objectId: string,
  shop: GameShop,
  trigger: string,
  observationKey: string | null,
  status: Extract<AutomaticSyncAttemptStatus, "settled" | "failed">,
  now = Date.now()
) => {
  if (!observationKey) return;
  attempts.set(attemptKey(objectId, shop, trigger), {
    observationKey,
    status,
    updatedAt: now,
  });
};

export const clearAutomaticSyncObservationState = () => {
  latestObservations.clear();
  attempts.clear();
};
