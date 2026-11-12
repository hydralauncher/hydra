import type {
  EpicAchievementTarget,
  EpicSnapshotGame,
} from "../../../types/epic-integration.types";
import type { EpicSyncContext } from "./sync-orchestrator";
import type { EpicSessionProvider } from "./session-provider";
import { EpicIntegrationError } from "./auth-protocol.js";
import { epicAbort, fetchEpicWithRetry } from "./source-retry.js";
import {
  EPIC_ACHIEVEMENT_BUDGET_MS,
  EPIC_ACHIEVEMENT_CONCURRENCY,
  EPIC_ACHIEVEMENT_GRAPHQL_URL,
  EPIC_ACHIEVEMENT_MAX_RESPONSE_BYTES,
  EPIC_ACHIEVEMENT_MAX_PER_SNAPSHOT,
  EPIC_ACHIEVEMENT_MAX_GAME_BYTES,
  EPIC_SOURCE_TIMEOUT_MS,
  EPIC_SNAPSHOT_CHUNK_GAMES,
} from "./constants.js";
import {
  EPIC_PLAYER_ACHIEVEMENT_QUERY,
  parseEpicPlayerAchievements,
} from "./achievement-protocol.js";

export interface EpicAchievementCollection {
  games: EpicSnapshotGame[];
  pendingObjectIds: string[];
  requiresReconnect: boolean;
}
const objectId = (game: EpicSnapshotGame) =>
  `${game.namespace}:${game.catalogItemId}`;
async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new EpicIntegrationError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > EPIC_ACHIEVEMENT_MAX_RESPONSE_BYTES)
        throw new EpicIntegrationError("snapshot-too-large");
      chunks.push(Buffer.from(next.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class EpicAchievementSource {
  constructor(
    private readonly session: Pick<EpicSessionProvider, "token">,
    private readonly fetchImpl = fetch
  ) {}
  async collect(
    context: EpicSyncContext,
    games: EpicSnapshotGame[],
    parent: AbortSignal,
    targets: (
      objectIds: string[],
      signal: AbortSignal
    ) => Promise<EpicAchievementTarget[]>,
    pending: string[] = [],
    progress: (processed: number, total: number) => void = () => {},
    budget = EPIC_ACHIEVEMENT_BUDGET_MS
  ): Promise<EpicAchievementCollection> {
    epicAbort(parent);
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal]);
    const timer = setTimeout(() => controller.abort(), Math.max(1, budget));
    const results = new Map<string, EpicSnapshotGame["achievements"]>();
    const completed = new Map<string, EpicSnapshotGame["achievements"]>();
    const unsupported = new Set<string>();
    const priority = new Set(pending);
    const ordered = [...games].sort(
      (a, b) =>
        Number(priority.has(objectId(b))) - Number(priority.has(objectId(a)))
    );
    let processed = 0,
      requiresReconnect = false;
    let refresh: Promise<string> | undefined;
    const renew = (used: string) =>
      (refresh ??= this.session
        .token(context.auth, context.connection, signal)
        .then((current) =>
          current !== used
            ? current
            : this.session.token(context.auth, context.connection, signal, true)
        )
        .finally(() => {
          refresh = undefined;
        }));
    try {
      for (
        let start = 0;
        start < ordered.length && !signal.aborted && !requiresReconnect;
        start += EPIC_SNAPSHOT_CHUNK_GAMES
      ) {
        const supported = new Map<string, string[]>();
        const ids = ordered
          .slice(start, start + EPIC_SNAPSHOT_CHUNK_GAMES)
          .map(objectId);
        try {
          for (const target of await targets(ids, signal)) {
            if (target.status === "unsupported")
              unsupported.add(target.objectId);
            if (target.status !== "supported" || !target.achievementSandboxId) {
              processed++;
              progress(processed, games.length);
              continue;
            }
            if (completed.has(target.achievementSandboxId)) {
              results.set(
                target.objectId,
                completed.get(target.achievementSandboxId)
              );
              processed++;
              progress(processed, games.length);
              continue;
            }
            const members = supported.get(target.achievementSandboxId) ?? [];
            members.push(target.objectId);
            supported.set(target.achievementSandboxId, members);
          }
        } catch {
          epicAbort(parent);
        }
        // Collect each resolved batch before spending the budget on later descriptors.
        const work = [...supported.entries()];
        let next = 0;
        await Promise.all(
          Array.from({ length: EPIC_ACHIEVEMENT_CONCURRENCY }, async () => {
            while (
              !signal.aborted &&
              !requiresReconnect &&
              next < work.length
            ) {
              const [sandbox, ids] = work[next++];
              try {
                let token = await this.session.token(
                  context.auth,
                  context.connection,
                  signal
                );
                let graphqlRefreshed = false;
                for (;;) {
                  const response = await fetchEpicWithRetry(
                    () =>
                      this.fetchImpl(EPIC_ACHIEVEMENT_GRAPHQL_URL, {
                        method: "POST",
                        redirect: "error",
                        signal: AbortSignal.any([
                          signal,
                          AbortSignal.timeout(EPIC_SOURCE_TIMEOUT_MS),
                        ]),
                        headers: {
                          Authorization: `Bearer ${token}`,
                          "Content-Type": "application/json",
                          Accept: "application/json",
                          "User-Agent": "EpicGamesLauncher/15.0.0",
                          Origin: "https://store.epicgames.com",
                          Referer: "https://store.epicgames.com/",
                        },
                        body: JSON.stringify({
                          query: EPIC_PLAYER_ACHIEVEMENT_QUERY,
                          variables: {
                            epicAccountId: context.connection.epicAccountId,
                            sandboxId: sandbox,
                          },
                        }),
                      }),
                    signal,
                    async () => {
                      token = await renew(token);
                    }
                  );
                  try {
                    const achievements = parseEpicPlayerAchievements(
                      await readResponse(response),
                      context.connection.epicAccountId,
                      sandbox
                    );
                    epicAbort(signal);
                    completed.set(sandbox, achievements);
                    for (const id of ids) results.set(id, achievements);
                    break;
                  } catch (error) {
                    if (
                      error instanceof EpicIntegrationError &&
                      error.code === "session-expired" &&
                      !graphqlRefreshed
                    ) {
                      graphqlRefreshed = true;
                      token = await renew(token);
                      continue;
                    }
                    throw error;
                  }
                }
              } catch (error) {
                epicAbort(parent);
                completed.set(sandbox, null);
                if (
                  error instanceof EpicIntegrationError &&
                  error.code === "session-expired"
                )
                  requiresReconnect = true;
              } finally {
                processed += ids.length;
                progress(processed, games.length);
              }
            }
          })
        );
      }
    } finally {
      clearTimeout(timer);
    }
    epicAbort(parent);
    let count = 0;
    const enriched = ordered.map((game) => {
      let achievements = results.get(objectId(game)) ?? null;
      if (
        achievements &&
        (count + achievements.length > EPIC_ACHIEVEMENT_MAX_PER_SNAPSHOT ||
          Buffer.byteLength(JSON.stringify({ ...game, achievements }), "utf8") >
            EPIC_ACHIEVEMENT_MAX_GAME_BYTES)
      )
        achievements = null;
      count += achievements?.length ?? 0;
      return { ...game, achievements };
    });
    const pendingObjectIds = enriched
      .filter(
        (game) => game.achievements === null && !unsupported.has(objectId(game))
      )
      .map(objectId);
    return { games: enriched, pendingObjectIds, requiresReconnect };
  }
}
