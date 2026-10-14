import type { EpicSnapshotGame } from "../../../types/epic-integration.types";
import { EpicIntegrationError } from "./auth-protocol.js";
import {
  EPIC_SNAPSHOT_CHUNK_GAMES,
  EPIC_SNAPSHOT_MAX_CHUNKS,
  EPIC_SNAPSHOT_MAX_CHUNK_BYTES,
  EPIC_SNAPSHOT_MAX_GAMES,
} from "./constants.js";

export interface EpicSnapshotChunk {
  connectionId: string;
  totalChunks: number;
  games: EpicSnapshotGame[];
}
export function buildEpicSnapshotChunks(
  connectionId: string,
  games: EpicSnapshotGame[]
): EpicSnapshotChunk[] {
  if (games.length > EPIC_SNAPSHOT_MAX_GAMES)
    throw new EpicIntegrationError("snapshot-too-large");
  const chunks: EpicSnapshotGame[][] = [[]];
  // Reserve the largest totalChunks representation before partitioning.
  const fits = (rows: EpicSnapshotGame[]) =>
    rows.length <= EPIC_SNAPSHOT_CHUNK_GAMES &&
    Buffer.byteLength(
      JSON.stringify({
        connectionId,
        totalChunks: EPIC_SNAPSHOT_MAX_CHUNKS,
        games: rows,
      }),
      "utf8"
    ) <= EPIC_SNAPSHOT_MAX_CHUNK_BYTES;
  for (const game of games) {
    if (!fits([game])) throw new EpicIntegrationError("snapshot-too-large");
    const current = chunks[chunks.length - 1];
    if (!fits([...current, game])) chunks.push([game]);
    else current.push(game);
  }
  if (chunks.length > EPIC_SNAPSHOT_MAX_CHUNKS)
    throw new EpicIntegrationError("snapshot-too-large");
  return chunks.map((games) => ({
    connectionId,
    totalChunks: chunks.length,
    games,
  }));
}
