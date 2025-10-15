import { registerEvent } from "../register-event";
import { downloadSourcesSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";

const updateMissingFingerprints = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<number> => {
  const sourcesNeedingFingerprints: Array<{
    id: number;
    objectIds: string[];
  }> = [];

  for await (const [, source] of downloadSourcesSublevel.iterator()) {
    if (
      !source.fingerprint &&
      source.objectIds &&
      source.objectIds.length > 0
    ) {
      sourcesNeedingFingerprints.push({
        id: source.id,
        objectIds: source.objectIds,
      });
    }
  }

  if (sourcesNeedingFingerprints.length === 0) {
    return 0;
  }

  logger.info(
    `Updating fingerprints for ${sourcesNeedingFingerprints.length} sources`
  );

  await Promise.all(
    sourcesNeedingFingerprints.map(async (source) => {
      try {
        const { fingerprint } = await HydraApi.put<{ fingerprint: string }>(
          "/download-sources",
          {
            objectIds: source.objectIds,
          },
          { needsAuth: false }
        );

        const existingSource = await downloadSourcesSublevel.get(
          `${source.id}`
        );
        if (existingSource) {
          await downloadSourcesSublevel.put(`${source.id}`, {
            ...existingSource,
            fingerprint,
            updatedAt: new Date(),
          });
        }
      } catch (error) {
        logger.error(
          `Failed to update fingerprint for source ${source.id}:`,
          error
        );
      }
    })
  );

  return sourcesNeedingFingerprints.length;
};

registerEvent("updateMissingFingerprints", updateMissingFingerprints);
