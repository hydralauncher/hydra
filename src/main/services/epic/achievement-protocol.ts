import type {
  EpicAchievementTarget,
  EpicSnapshotAchievement,
} from "../../../types/epic-integration.types";
import { EpicIntegrationError, isRecord } from "./auth-protocol.js";
import {
  EPIC_ACHIEVEMENT_MAX_PER_GAME,
  EPIC_ID_MAX_LENGTH,
} from "./constants.js";

export const EPIC_PLAYER_ACHIEVEMENT_QUERY = `query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) {
  PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) {
    records { totalUnlocked playerAchievements { playerAchievement { epicAccountId sandboxId achievementSetId achievementName unlocked unlockDate } } }
  } }
}`;
const invalid = (): never => {
  throw new EpicIntegrationError("invalid-response");
};
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= EPIC_ID_MAX_LENGTH &&
  !/[\p{Cc}]/u.test(value);

export function parseEpicAchievementTargets(
  value: unknown,
  objectIds: string[]
): EpicAchievementTarget[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.targets) ||
    value.targets.length !== objectIds.length
  )
    return invalid();
  const expected = new Set(objectIds);
  const seen = new Set<string>();
  return value.targets.map((row) => {
    if (
      !isRecord(row) ||
      typeof row.objectId !== "string" ||
      !expected.has(row.objectId) ||
      seen.has(row.objectId) ||
      !["supported", "unsupported", "unavailable"].includes(
        row.status as string
      ) ||
      (row.status === "supported" && !id(row.achievementSandboxId))
    )
      return invalid();
    seen.add(row.objectId);
    return {
      objectId: row.objectId,
      status: row.status as EpicAchievementTarget["status"],
      ...(id(row.achievementSandboxId)
        ? { achievementSandboxId: row.achievementSandboxId }
        : {}),
    };
  });
}

export function parseEpicPlayerAchievements(
  value: unknown,
  accountId: string,
  sandboxId: string
): EpicSnapshotAchievement[] {
  if (!isRecord(value)) return invalid();
  if (
    value.errors !== undefined &&
    (!Array.isArray(value.errors) || value.errors.length)
  ) {
    const errors = Array.isArray(value.errors) ? value.errors : [];
    const codes = errors.map((error) =>
      isRecord(error) && isRecord(error.extensions)
        ? String(error.extensions.code ?? "")
        : ""
    );
    if (
      codes.some((code) =>
        /unauthenticated|invalid.?token|authentication/i.test(code)
      )
    )
      throw new EpicIntegrationError("session-expired");
    if (codes.some((code) => /forbidden|permission|privacy/i.test(code)))
      throw new EpicIntegrationError("source-permission");
    if (codes.some((code) => /rate.?limit|too.?many/i.test(code)))
      throw new EpicIntegrationError("rate-limit");
    return invalid();
  }
  const data = value.data;
  const player = isRecord(data) ? data.PlayerAchievement : undefined;
  const result = isRecord(player)
    ? player.playerAchievementGameRecordsBySandbox
    : undefined;
  if (
    !isRecord(result) ||
    !Array.isArray(result.records) ||
    result.records.length !== 1
  )
    return invalid();
  const record = result.records[0];
  if (
    !isRecord(record) ||
    !Number.isInteger(record.totalUnlocked) ||
    (record.totalUnlocked as number) < 0 ||
    !Array.isArray(record.playerAchievements)
  )
    return invalid();
  const unlocked: EpicSnapshotAchievement[] = [];
  const seen = new Set<string>();
  for (const entry of record.playerAchievements) {
    const row = isRecord(entry) ? entry.playerAchievement : undefined;
    if (
      !isRecord(row) ||
      row.epicAccountId !== accountId ||
      row.sandboxId !== sandboxId ||
      typeof row.unlocked !== "boolean" ||
      !id(row.achievementSetId) ||
      !id(row.achievementName)
    )
      return invalid();
    const key = JSON.stringify([row.achievementSetId, row.achievementName]);
    if (seen.has(key)) return invalid();
    seen.add(key);
    if (!row.unlocked) continue;
    if (
      typeof row.unlockDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.unlockDate) ||
      !Number.isFinite(Date.parse(row.unlockDate)) ||
      Date.parse(row.unlockDate) <= 0
    )
      return invalid();
    unlocked.push({
      externalSetId: row.achievementSetId,
      externalId: row.achievementName,
      unlockTime: new Date(row.unlockDate).toISOString(),
    });
  }
  if (
    unlocked.length !== record.totalUnlocked ||
    unlocked.length > EPIC_ACHIEVEMENT_MAX_PER_GAME
  )
    return invalid();
  return unlocked.sort((a, b) =>
    JSON.stringify([a.externalSetId, a.externalId]).localeCompare(
      JSON.stringify([b.externalSetId, b.externalId])
    )
  );
}
