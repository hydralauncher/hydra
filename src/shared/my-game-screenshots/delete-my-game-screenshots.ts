import {
  buildProfileGameScreenshotsPath,
  buildProfileScreenshotPath,
  getScreenshotApiErrorCode,
  type ScreenshotApiErrorCode,
} from "../screenshots";
import type { LocalScreenshot } from "@types";
import type {
  MyGameScreenshotsApi,
  MyGameScreenshotsLocalBridge,
  MyGameScreenshotsTarget,
} from "./my-game-screenshots";

export type MyScreenshotsDeletion = "all" | "published" | "local";

export type MyScreenshotsDeletionErrorCode =
  | ScreenshotApiErrorCode
  | "screenshots/local-deletion-incomplete";

export type MyScreenshotsDeletionResult =
  | { ok: true; deleted: number }
  | {
      ok: false;
      deleted: number;
      errorCode: MyScreenshotsDeletionErrorCode | null;
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

const LOCAL_DELETION_INCOMPLETE = "screenshots/local-deletion-incomplete";

interface DeletionOutcome {
  deleted: number;
  isComplete: boolean;
}

const deleteLocalFiles = async ({ target, local }: DeletionContext) => {
  const { shop, objectId } = target;
  const expected = await local.countLocalScreenshotFiles(shop, objectId);
  const deleted = await local.deleteLocalScreenshotsForGame(shop, objectId);
  return { deleted, expected, isComplete: deleted >= expected };
};

const isUnsentLocalFile = ({ state }: LocalScreenshot) => state !== "uploaded";

const runDeletion = async (
  deletion: MyScreenshotsDeletion,
  context: DeletionContext
): Promise<DeletionOutcome> => {
  const { shop, objectId, isSignedIn = true } = context.target;

  if (deletion === "local") {
    const { deleted, isComplete } = await deleteLocalFiles(context);
    return { deleted, isComplete };
  }
  if (deletion === "published") {
    if (!isSignedIn) return { deleted: 0, isComplete: true };
    return { deleted: await deletePublished(context), isComplete: true };
  }

  if (!isSignedIn) {
    const { deleted, isComplete } = await deleteLocalFiles(context);
    return { deleted, isComplete };
  }

  const pendingBefore = (
    await context.local.getLocalScreenshotsForGame(shop, objectId)
  ).filter(isUnsentLocalFile).length;
  const published = await deletePublished(context);
  const local = await deleteLocalFiles(context);
  const restoredCopies = Math.max(0, local.expected - pendingBefore);
  return {
    deleted: published + Math.max(0, local.deleted - restoredCopies),
    isComplete: local.isComplete,
  };
};

export const deleteMyGameScreenshots = async (
  deletion: MyScreenshotsDeletion,
  target: MyGameScreenshotsTarget,
  api: MyGameScreenshotsApi,
  local: MyGameScreenshotsLocalBridge
): Promise<MyScreenshotsDeletionResult> => {
  try {
    const { deleted, isComplete } = await runDeletion(deletion, {
      target,
      api,
      local,
    });
    if (isComplete) return { ok: true, deleted };
    return {
      ok: false,
      deleted,
      errorCode: LOCAL_DELETION_INCOMPLETE,
      error: null,
    };
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
