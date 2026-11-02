import { normalizeScreenshotDescription } from "@shared";
import type { LocalScreenshot, LocalScreenshotDraft } from "@types";

const DRAFT_EDITABLE_STATES = new Set<LocalScreenshot["state"]>([
  "local",
  "failed",
]);

export const buildLocalScreenshotDraftPatch = (
  current: LocalScreenshot,
  draft: LocalScreenshotDraft
): Partial<LocalScreenshot> => {
  if (!DRAFT_EDITABLE_STATES.has(current.state)) return {};

  const patch: Partial<LocalScreenshot> = {};
  if (draft.isSpoiler !== undefined) patch.isSpoiler = draft.isSpoiler;
  if (draft.visibility !== undefined) patch.visibility = draft.visibility;
  if (draft.commentsEnabled !== undefined) {
    patch.commentsEnabled = draft.commentsEnabled;
  }
  if (draft.customGameTitle !== undefined && current.shop === "custom") {
    patch.customGameTitle = draft.customGameTitle?.trim() || null;
  }
  if (draft.description !== undefined) {
    patch.description = normalizeScreenshotDescription(draft.description);
  }
  return patch;
};
