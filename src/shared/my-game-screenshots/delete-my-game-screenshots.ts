import {
  buildProfileGameScreenshotsPath,
  buildProfileScreenshotPath,
  getScreenshotApiErrorCode,
  type ScreenshotApiErrorCode,
} from "../screenshots";
import type {
  MyGameScreenshotsApi,
  MyGameScreenshotsLocalBridge,
  MyGameScreenshotsTarget,
} from "./my-game-screenshots";

export type MyScreenshotsDeletion = "all" | "published" | "local";

export type MyScreenshotsDeletionResult =
  | { ok: true; deleted: number }
  | {
      ok: false;
      deleted: number;
      errorCode: ScreenshotApiErrorCode | null;
      error: unknown;
    };

interface DeletionContext {
  target: MyGameScreenshotsTarget;
  api: MyGameScreenshotsApi;
  local: MyGameScreenshotsLocalBridge;
}

class PartialDeletionError extends Error {
  constructor(
    readonly deleted: number,
    readonly reason: unknown
  ) {
    super("Screenshot deletion stopped partway");
  }
}

const deletePublishedScreenshot = async (
  api: MyGameScreenshotsApi,
  id: string
) => {
  try {
    await api.delete(buildProfileScreenshotPath(id));
  } catch (error) {
    if (getScreenshotApiErrorCode(error) !== "screenshots/not-found") {
      throw error;
    }
  }
};

const deleteSequentially = async (
  api: MyGameScreenshotsApi,
  ids: string[],
  deletedIds: string[]
): Promise<void> => {
  const [head, ...tail] = ids;
  if (head === undefined) return;
  await deletePublishedScreenshot(api, head);
  deletedIds.push(head);
  return deleteSequentially(api, tail, deletedIds);
};

const deletePublished = async ({ target, api, local }: DeletionContext) => {
  const { shop, objectId } = target;

  if (shop !== "custom") {
    const response = await api.delete<{ deleted: number }>(
      buildProfileGameScreenshotsPath({ shop, objectId })
    );
    const ids = await local.getPublishedScreenshotIdsForGame(shop, objectId);
    if (ids.length > 0) await local.forgetPublishedScreenshots(ids);
    return response?.deleted ?? 0;
  }

  const ids = await local.getPublishedScreenshotIdsForGame(shop, objectId);
  const deletedIds: string[] = [];

  try {
    await deleteSequentially(api, ids, deletedIds);
  } catch (error) {
    throw new PartialDeletionError(deletedIds.length, error);
  } finally {
    if (deletedIds.length > 0) {
      await local.forgetPublishedScreenshots(deletedIds);
    }
  }

  return deletedIds.length;
};

const runDeletion = async (
  deletion: MyScreenshotsDeletion,
  context: DeletionContext
) => {
  const { shop, objectId } = context.target;

  if (deletion === "local") {
    return context.local.deleteLocalScreenshotsForGame(shop, objectId);
  }
  if (deletion === "published") return deletePublished(context);

  const localBefore = (
    await context.local.getLocalScreenshotsForGame(shop, objectId)
  ).length;
  const published = await deletePublished(context);
  await context.local.deleteLocalScreenshotsForGame(shop, objectId);
  return published + localBefore;
};

export const deleteMyGameScreenshots = async (
  deletion: MyScreenshotsDeletion,
  target: MyGameScreenshotsTarget,
  api: MyGameScreenshotsApi,
  local: MyGameScreenshotsLocalBridge
): Promise<MyScreenshotsDeletionResult> => {
  try {
    const deleted = await runDeletion(deletion, { target, api, local });
    return { ok: true, deleted };
  } catch (error) {
    const cause = error instanceof PartialDeletionError ? error.reason : error;
    return {
      ok: false,
      deleted: error instanceof PartialDeletionError ? error.deleted : 0,
      errorCode: getScreenshotApiErrorCode(cause),
      error: cause,
    };
  }
};
