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

const forgetPublished = async (
  { local }: DeletionContext,
  deletedIds: string[]
) => {
  if (deletedIds.length > 0) await local.forgetPublishedScreenshots(deletedIds);
};

const getPublishedIds = ({ target, local }: DeletionContext) =>
  local.getPublishedScreenshotIdsForGame(target.shop, target.objectId);

const deletePublishedOnServer = async (
  context: DeletionContext,
  ids: string[]
) => {
  const { target, api } = context;
  const { shop, objectId } = target;

  if (shop !== "custom") {
    const response = await api.delete<{ deleted: number }>(
      buildProfileGameScreenshotsPath({ shop, objectId })
    );
    return response?.deleted ?? 0;
  }

  const deletedIds: string[] = [];
  try {
    for (const id of ids) {
      await deletePublishedScreenshot(api, id);
      deletedIds.push(id);
    }
  } catch (error) {
    await forgetPublished(context, deletedIds);
    throw new PartialDeletionError(deletedIds.length, error);
  }
  return deletedIds.length;
};

const deletePublished = async (context: DeletionContext) => {
  const ids = await getPublishedIds(context);
  const deleted = await deletePublishedOnServer(context, ids);
  await forgetPublished(context, ids);
  return deleted;
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

const isUnsentLocalFile = ({
  state,
  pendingCompleteScreenshotId,
}: LocalScreenshot) => state !== "uploaded" && !pendingCompleteScreenshotId;

const deleteLatePublished = async (
  context: DeletionContext,
  knownIds: string[]
) => {
  const known = new Set(knownIds);
  const lateIds = (await getPublishedIds(context)).filter(
    (id) => !known.has(id)
  );
  const deletedIds: string[] = [];
  try {
    for (const id of lateIds) {
      await deletePublishedScreenshot(context.api, id);
      deletedIds.push(id);
    }
  } finally {
    await forgetPublished(context, [...knownIds, ...deletedIds]);
  }
};

const deleteAll = async (context: DeletionContext) => {
  const { shop, objectId } = context.target;
  const screenshots = await context.local.getLocalScreenshotsForGame(
    shop,
    objectId
  );
  const pendingBefore = screenshots.filter(isUnsentLocalFile).length;
  const publishedIds = await getPublishedIds(context);
  const knownIds =
    shop === "custom"
      ? [
          ...new Set([
            ...publishedIds,
            ...screenshots.flatMap(({ pendingCompleteScreenshotId }) =>
              pendingCompleteScreenshotId ? [pendingCompleteScreenshotId] : []
            ),
          ]),
        ]
      : publishedIds;

  const published = await deletePublishedOnServer(context, knownIds);

  const local = await deleteLocalFiles(context);
  const publishedCopies = Math.max(0, local.expected - pendingBefore);
  const unsentDeleted = Math.max(0, local.deleted - publishedCopies);
  const deleted = published + unsentDeleted;

  try {
    await deleteLatePublished(context, knownIds);
  } catch (error) {
    throw new PartialDeletionError(deleted, error);
  }
  return { deleted, isComplete: local.isComplete };
};

const runDeletion = async (
  deletion: MyScreenshotsDeletion,
  context: DeletionContext
): Promise<DeletionOutcome> => {
  const { isSignedIn = true } = context.target;

  if (deletion === "local" || (deletion === "all" && !isSignedIn)) {
    const { deleted, isComplete } = await deleteLocalFiles(context);
    return { deleted, isComplete };
  }
  if (deletion === "published") {
    if (!isSignedIn) return { deleted: 0, isComplete: true };
    return { deleted: await deletePublished(context), isComplete: true };
  }

  return deleteAll(context);
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
