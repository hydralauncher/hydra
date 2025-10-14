import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { HydraApi } from "@main/services";
import {
  importDownloadSourceToLocal,
  invalidateDownloadSourcesCache,
} from "./helpers";

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
  const repackIds: number[] = [];
  for await (const [, repack] of repacksSublevel.iterator()) {
    if (repack.downloadSourceId === result.id) {
      repackCount++;
      repackIds.push(repack.id);
    }
  }

  // Log for debugging - helps identify if repacks are being created
  console.log(
    `✅ Download source ${result.id} (${result.name}) created with ${repackCount} repacks`
  );
  console.log(
    `   Repack IDs: [${repackIds.slice(0, 5).join(", ")}${repackIds.length > 5 ? "..." : ""}]`
  );
  console.log(
    `   Object IDs: [${result.objectIds.slice(0, 5).join(", ")}${result.objectIds.length > 5 ? "..." : ""}]`
  );

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
    console.warn(
      `⚠️  Repack count mismatch! Before: ${repackCount}, After: ${finalRepackCount}`
    );
  } else {
    console.log(
      `✅ Final verification passed: ${finalRepackCount} repacks confirmed`
    );
  }

  // Invalidate cache to ensure fresh data on next read
  invalidateDownloadSourcesCache();

  return {
    ...result,
    fingerprint,
  };
};

registerEvent("addDownloadSource", addDownloadSource);
