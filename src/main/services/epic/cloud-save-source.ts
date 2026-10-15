import type { EpicManagedTarget } from "./legendary-managed-runtime";
import type { EpicSessionProvider } from "./session-provider";
import {
  EpicSaveFailure,
  parseEpicRemoteManifest,
} from "./cloud-save-protocol.js";
import { fetchEpicWithRetry } from "./source-retry.js";
import {
  EPIC_SAVE_STORAGE_ORIGIN,
  EPIC_SAVE_MAX_RESPONSE_BYTES,
  EPIC_SOURCE_TIMEOUT_MS,
} from "./constants.js";

export class EpicCloudSaveSource {
  constructor(
    private readonly session: Pick<EpicSessionProvider, "token">,
    private readonly fetchImpl = fetch
  ) {}

  async latest(target: EpicManagedTarget, parent: AbortSignal) {
    const signal = AbortSignal.any([
      parent,
      AbortSignal.timeout(EPIC_SOURCE_TIMEOUT_MS),
    ]);
    let token = await this.session.token(
      target.auth,
      target.connection,
      signal
    );
    // list-saves only prints names, discarding the upload dates used by sync-saves.
    const url = `${EPIC_SAVE_STORAGE_ORIGIN}/api/v1/access/egstore/savesync/${encodeURIComponent(target.owner.epicAccountId)}/${encodeURIComponent(target.artifactId)}/manifests/`;
    const response = await fetchEpicWithRetry(
      () =>
        this.fetchImpl(url, {
          signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "EpicGamesLauncher/15.0.0",
          },
        }),
      signal,
      async () => {
        token = await this.session.token(
          target.auth,
          target.connection,
          signal,
          true
        );
      }
    );
    if (!response.body) throw new EpicSaveFailure("save-sync-failed");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > EPIC_SAVE_MAX_RESPONSE_BYTES)
          throw new EpicSaveFailure("save-sync-failed");
        chunks.push(Buffer.from(next.value));
      }
      signal.throwIfAborted();
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new EpicSaveFailure("save-sync-failed");
      }
      return parseEpicRemoteManifest(
        input,
        target.artifactId,
        target.owner.epicAccountId
      );
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}
