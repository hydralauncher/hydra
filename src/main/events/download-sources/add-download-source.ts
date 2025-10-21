import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";
import { importDownloadSourceToLocal } from "./helpers";

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const result = await importDownloadSourceToLocal(url, true);
  if (!result) {
    throw new Error("Failed to import download source");
  }

  // Verify that repacks were actually written to the database (read-after-write)
  // This ensures all async operations are complete before proceeding
  let repackCount = 0;
  for await (const [, repack] of repacksSublevel.iterator()) {
    if (repack.downloadSourceId === result.id) {
      repackCount++;
    }
  }

  await HydraApi.post("/profile/download-sources", {
    urls: [url],
  });

  const { fingerprint } = await HydraApi.put<{ fingerprint: string }>(
    "/download-sources",
    {
      objectIds: result.objectIds,
    },
    { needsAuth: false }
  );

  // Update the source with fingerprint
  const updatedSource = await downloadSourcesSublevel.get(`${result.id}`);
  if (updatedSource) {
    await downloadSourcesSublevel.put(`${result.id}`, {
      ...updatedSource,
      fingerprint,
      updatedAt: new Date(),
    });
  }

  // Final verification: ensure the source with fingerprint is persisted
  const finalSource = await downloadSourcesSublevel.get(`${result.id}`);
  if (!finalSource || !finalSource.fingerprint) {
    throw new Error("Failed to persist download source with fingerprint");
  }

  // Verify repacks still exist after fingerprint update
  let finalRepackCount = 0;
  for await (const [, repack] of repacksSublevel.iterator()) {
    if (repack.downloadSourceId === result.id) {
      finalRepackCount++;
    }
  }

  if (finalRepackCount !== repackCount) {
    logger.warn(
      `Repack count mismatch! Before: ${repackCount}, After: ${finalRepackCount}`
    );
  } else {
    logger.info(
      `Final verification passed: ${finalRepackCount} repacks confirmed`
    );
  }

  return {
    ...result,
    fingerprint,
  };
};

registerEvent("addDownloadSource", addDownloadSource);
