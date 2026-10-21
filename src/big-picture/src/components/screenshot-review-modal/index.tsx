import "./styles.scss";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ImageIcon,
  SkipForwardIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotReviewRequest,
} from "@types";
import {
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotDescription,
  sanitizeScreenshotDescriptionInput,
  isScreenshotUploadRetryable,
  resolveScreenshotPreferences,
} from "@shared";
import { logger } from "@renderer/logger";
import { useReviewDraftSave } from "./use-review-draft-save";

import {
  Button,
  Checkbox,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../common";
import { ConfirmationModal } from "../modals";
import { IS_DESKTOP } from "../../constants";
import { resolveImageSource } from "../../helpers";
import { useNavigationStore } from "../../stores";
import { getLocalScreenshotStatusDetail } from "../pages/screenshots";
import { useScreenshotDialogPresenceStore } from "../pages/screenshots/screenshot-dialog-presence";
import {
  useBigPictureToast,
  useNavigation,
  useUserPreferences,
} from "../../hooks";
import {
  EMPTY_REVIEW_QUEUE,
  advanceReviewQueuePast,
  closeReviewQueue,
  dropMissingReviewItems,
  enqueueReviewRequest,
  getCurrentReviewItem,
  getUndecidedReviewIds,
  isReviewListFresh,
  isReviewQueueOpen,
  recordReviewDecision,
  type ReviewDecision,
  type ReviewQueueState,
} from "./review-queue";

const REGION_ID = "screenshot-review-modal";
const ACTIONS_REGION_ID = "screenshot-review-modal-actions";
const TITLE_FOCUS_ID = "screenshot-review-title";
const DESCRIPTION_FOCUS_ID = "screenshot-review-description";
const SPOILER_FOCUS_ID = "screenshot-review-spoiler";
const VISIBILITY_FOCUS_ID = "screenshot-review-visibility";
const UPLOAD_FOCUS_ID = "screenshot-review-upload";
const SKIP_FOCUS_ID = "screenshot-review-skip";
const DELETE_FOCUS_ID = "screenshot-review-delete";
const NEXT_FOCUS_ID = "screenshot-review-next";
const RETRY_FOCUS_ID = "screenshot-review-retry";
const FIELD_FOCUS_IDS = new Set([
  TITLE_FOCUS_ID,
  DESCRIPTION_FOCUS_ID,
  SPOILER_FOCUS_ID,
  VISIBILITY_FOCUS_ID,
]);

interface ReviewDraft {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string;
  description: string;
}

function getUploadStatusKey(screenshot: LocalScreenshot | undefined) {
  if (!screenshot) return "screenshots_review_upload_queued";
  if (screenshot.state === "failed") return "screenshots_review_upload_failed";
  if (screenshot.state === "uploaded") {
    return screenshot.moderationStatus === "BLOCKED"
      ? "screenshots_review_upload_blocked"
      : "screenshots_review_upload_done";
  }
  if (screenshot.state === "uploading")
    return "screenshots_review_upload_progress";

  return "screenshots_review_upload_queued";
}

function useLocalScreenshots(isActive: boolean, requestCount: number) {
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [loadedRequestCount, setLoadedRequestCount] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (!isActive) {
      setScreenshots([]);
      setLoadedRequestCount(null);
      return;
    }

    if (!IS_DESKTOP) return;

    let isCurrent = true;

    globalThis.window.electron
      .getLocalScreenshots()
      .then((items) => {
        if (!isCurrent) return;
        setScreenshots(items);
        setLoadedRequestCount(requestCount);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots", error);
      });

    return () => {
      isCurrent = false;
    };
  }, [isActive, requestCount]);

  useEffect(() => {
    if (!IS_DESKTOP || !isActive) return;

    const unsubscribeChange =
      globalThis.window.electron.onLocalScreenshotsChange(setScreenshots);
    const unsubscribeProgress =
      globalThis.window.electron.onScreenshotUploadProgress((progress) => {
        setScreenshots((current) =>
          current.map((item) =>
            item.clientId === progress.clientId
              ? {
                  ...item,
                  state: progress.state,
                  uploadProgress: progress.progress,
                }
              : item
          )
        );
      });

    return () => {
      unsubscribeChange();
      unsubscribeProgress();
    };
  }, [isActive]);

  return { screenshots, loadedRequestCount };
}

const keepScreenshotsLocally = (clientIds: string[]) => {
  for (const clientId of clientIds) {
    void globalThis.window.electron
      .skipLocalScreenshot(clientId)
      .catch((error: unknown) => {
        logger.error("Failed to keep the screenshot locally", error);
      });
  }
};

interface ReviewPreviewProps {
  screenshot: LocalScreenshot | undefined;
  gameTitle: string;
}

function ReviewPreview({
  screenshot,
  gameTitle,
}: Readonly<ReviewPreviewProps>) {
  const { t } = useTranslation("big_picture");
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const source = screenshot ? resolveImageSource(screenshot.path) : "";
  const hasImage = Boolean(source) && screenshot?.path !== failedPath;

  return (
    <div className="screenshot-review-modal__preview">
      {hasImage ? (
        <img
          src={source}
          alt={t("screenshots_review_preview_alt", { game: gameTitle })}
          draggable={false}
          onError={() => setFailedPath(screenshot?.path ?? null)}
        />
      ) : (
        <ImageIcon size={48} />
      )}
    </div>
  );
}

interface UploadStatusProps {
  screenshot: LocalScreenshot | undefined;
}

function UploadStatus({ screenshot }: Readonly<UploadStatusProps>) {
  const { t } = useTranslation("big_picture");
  const progress = Math.round((screenshot?.uploadProgress ?? 0) * 100);
  const isFailed = screenshot?.state === "failed";
  const isDone = screenshot?.state === "uploaded";
  const detail = getLocalScreenshotStatusDetail(screenshot, t);

  return (
    <div className="screenshot-review-modal__status">
      <div className="screenshot-review-modal__status-line">
        {isFailed ? <WarningCircleIcon size={20} /> : null}
        {isDone ? <CheckCircleIcon size={20} /> : null}
        <span>{t(getUploadStatusKey(screenshot), { progress })}</span>
      </div>

      {detail ? (
        <span className="screenshot-review-modal__status-detail">{detail}</span>
      ) : null}

      {isFailed || isDone ? null : (
        <progress
          className="screenshot-review-modal__progress"
          value={progress}
          max={100}
        />
      )}
    </div>
  );
}

export function ScreenshotReviewModal() {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const { showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const [queueState, setQueueState] =
    useState<ReviewQueueState>(EMPTY_REVIEW_QUEUE);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [pendingAction, setPendingAction] = useState<ReviewDecision | null>(
    null
  );
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const {
    schedule: scheduleDraftSave,
    save: saveDraft,
    cancel: cancelDraftSave,
    flushAll: flushDraftSaves,
  } = useReviewDraftSave();
  const fieldsRef = useRef<HTMLDivElement | null>(null);
  const isQueueOpen = isReviewQueueOpen(queueState);
  const isScreenshotDialogOpen = useScreenshotDialogPresenceStore(
    (state) => state.openCount > 0
  );
  const [isPresented, setIsPresented] = useState(false);
  const visible = isQueueOpen && isPresented;

  useEffect(() => {
    if (!isQueueOpen) setIsPresented(false);
    else if (!isScreenshotDialogOpen) setIsPresented(true);
  }, [isQueueOpen, isScreenshotDialogOpen]);
  const { screenshots, loadedRequestCount } = useLocalScreenshots(
    visible,
    queueState.requestCount
  );
  const isListFresh = isReviewListFresh(queueState, loadedRequestCount);
  const { items: queue, index, decisions } = queueState;
  const defaultVisibility =
    resolveScreenshotPreferences(userPreferences).defaultVisibility;
  const defaultVisibilityRef = useRef(defaultVisibility);
  defaultVisibilityRef.current = defaultVisibility;

  useEffect(() => {
    if (!IS_DESKTOP) return;

    let isSubscribed = true;
    const enqueue = (request: ScreenshotReviewRequest) => {
      setQueueState((current) => enqueueReviewRequest(current, request));
    };
    const unsubscribe =
      globalThis.window.electron.onScreenshotReviewRequested(enqueue);

    globalThis.window.electron
      .getPendingScreenshotReviewRequest()
      .then((request) => {
        if (isSubscribed && request) enqueue(request);
      })
      .catch((error: unknown) => {
        logger.error("Failed to read the pending screenshot review", error);
      });

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, []);

  const current = getCurrentReviewItem(queueState);
  const currentScreenshot = useMemo(
    () => screenshots.find((item) => item.clientId === current?.clientId),
    [current?.clientId, screenshots]
  );
  const decision = current ? decisions[current.clientId] : undefined;
  const isCustomGame = current?.shop === "custom";
  const draft: ReviewDraft = (current && drafts[current.clientId]) ?? {
    isSpoiler: currentScreenshot?.isSpoiler ?? false,
    visibility: defaultVisibilityRef.current,
    customGameTitle: currentScreenshot?.customGameTitle ?? "",
    description: currentScreenshot?.description ?? "",
  };

  const updateDraft = (update: Partial<ReviewDraft>) => {
    if (!current) return;
    const nextDraft = { ...draft, ...update };
    setDrafts((existing) => ({
      ...existing,
      [current.clientId]: nextDraft,
    }));
    scheduleDraftSave(current.clientId, {
      isSpoiler: nextDraft.isSpoiler,
      visibility: nextDraft.visibility,
      customGameTitle: nextDraft.customGameTitle.trim() || null,
      description: normalizeScreenshotDescription(nextDraft.description),
    });
  };

  useEffect(() => {
    if (visible) return;

    flushDraftSaves();
    setDrafts({});
    setPendingAction(null);
    setIsDeleteConfirmVisible(false);
  }, [flushDraftSaves, visible]);

  const goToNextFrom = useCallback((clientId: string) => {
    setQueueState((state) => advanceReviewQueuePast(state, clientId));
  }, []);

  useEffect(() => {
    if (!visible) return;

    const focusId = decision === "upload" ? NEXT_FOCUS_ID : UPLOAD_FOCUS_ID;
    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(focusId);
      globalThis.document
        .getElementById(focusId)
        ?.scrollIntoView({ block: "nearest" });

      const fields = fieldsRef.current;
      if (fields) fields.scrollTop = fields.scrollHeight;
    });

    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [decision, index, setFocus, visible]);

  useEffect(() => {
    if (!visible || !currentFocusId) return;
    if (!FIELD_FOCUS_IDS.has(currentFocusId)) return;

    globalThis.document
      .getElementById(currentFocusId)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentFocusId, visible]);

  useEffect(() => {
    if (!isListFresh || pendingAction) return;

    const availableIds = new Set(screenshots.map((item) => item.clientId));
    const { state: nextState, droppedIds } = dropMissingReviewItems(
      queueState,
      availableIds
    );
    if (droppedIds.length === 0) return;

    keepScreenshotsLocally(droppedIds);
    setQueueState(nextState);
  }, [isListFresh, pendingAction, queueState, screenshots]);

  const runAction = async (
    action: ReviewDecision,
    task: () => Promise<unknown>
  ) => {
    if (!current || pendingAction) return false;

    setPendingAction(action);

    try {
      const result = await task();
      if (action === "upload" && !result) {
        showErrorToast(t("screenshots_settings_sign_in_to_upload"), {
          fallbackVisual: "settings",
        });
        return false;
      }
      setQueueState((state) =>
        recordReviewDecision(state, current.clientId, action)
      );
      return true;
    } catch (error) {
      logger.error(`Failed to ${action} the screenshot`, error);
      showErrorToast(t("screenshots_review_action_failed"), {
        fallbackVisual: "settings",
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const upload = () => {
    if (!current) return;

    const customGameTitle = draft.customGameTitle.trim();
    cancelDraftSave(current.clientId);

    void runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(current.clientId, {
        isSpoiler: draft.isSpoiler,
        visibility: draft.visibility,
        customGameTitle:
          isCustomGame && customGameTitle ? customGameTitle : null,
        description: normalizeScreenshotDescription(draft.description),
      })
    );
  };

  const skip = async () => {
    if (!current) return;

    const { clientId } = current;
    saveDraft(clientId);
    const done = await runAction("skip", () =>
      globalThis.window.electron.skipLocalScreenshot(clientId)
    );
    if (done) goToNextFrom(clientId);
  };

  const remove = async () => {
    if (!current) return;

    const { clientId } = current;
    cancelDraftSave(clientId);
    const done = await runAction("delete", () =>
      globalThis.window.electron.deleteLocalScreenshot(clientId)
    );
    setIsDeleteConfirmVisible(false);
    if (done) goToNextFrom(clientId);
  };

  const close = () => {
    keepScreenshotsLocally(getUndecidedReviewIds(queueState));
    setQueueState(closeReviewQueue);
  };

  const visibilityOptions = useMemo<DropdownSelectOption<ProfileVisibility>[]>(
    () => [
      { value: "PUBLIC", label: t("screenshots_visibility_public") },
      { value: "FRIENDS", label: t("screenshots_visibility_friends") },
      { value: "PRIVATE", label: t("screenshots_visibility_private") },
    ],
    [t]
  );

  if (!current) return null;

  const gameTitle =
    (isCustomGame && draft.customGameTitle.trim()) ||
    current.gameTitle ||
    t("screenshots_custom_game");
  const isUploading = decision === "upload";
  const canRetry =
    isUploading &&
    currentScreenshot?.state === "failed" &&
    isScreenshotUploadRetryable(currentScreenshot.lastError);
  const isBusy = pendingAction !== null;

  return (
    <Modal
      visible={visible}
      title={t("screenshots_review_title")}
      description={t("screenshots_review_counter", {
        current: index + 1,
        total: queue.length,
      })}
      onClose={close}
      closeOnBackdrop={false}
      closeOnB={!isBusy}
      closeOnEscape={!isBusy}
      initialFocusId={UPLOAD_FOCUS_ID}
      className="screenshot-review-modal"
      backdropClassName="screenshot-review-modal__backdrop"
    >
      <VerticalFocusGroup
        regionId={REGION_ID}
        className="screenshot-review-modal__content"
      >
        <ReviewPreview
          key={current.clientId}
          screenshot={currentScreenshot}
          gameTitle={gameTitle}
        />

        <div className="screenshot-review-modal__form">
          <div ref={fieldsRef} className="screenshot-review-modal__fields">
            {isCustomGame ? (
              <Input
                label={t("screenshots_custom_title_label")}
                placeholder={t("screenshots_custom_game")}
                value={draft.customGameTitle}
                maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
                disabled={isUploading || isBusy}
                focusId={TITLE_FOCUS_ID}
                onChange={(event) =>
                  updateDraft({ customGameTitle: event.target.value })
                }
              />
            ) : (
              <p className="screenshot-review-modal__game">{gameTitle}</p>
            )}

            {isUploading ? (
              <UploadStatus screenshot={currentScreenshot} />
            ) : (
              <>
                <Input
                  label={t("screenshots_description_label")}
                  placeholder={t("screenshots_description_placeholder")}
                  value={draft.description}
                  maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
                  hint={`${draft.description.length}/${SCREENSHOT_DESCRIPTION_MAX_LENGTH}`}
                  disabled={isBusy}
                  focusId={DESCRIPTION_FOCUS_ID}
                  onChange={(event) =>
                    updateDraft({
                      description: sanitizeScreenshotDescriptionInput(
                        event.target.value
                      ),
                    })
                  }
                />

                <Checkbox
                  block
                  label={t("screenshots_mark_spoiler")}
                  secondaryText={t("screenshots_mark_spoiler_description")}
                  checked={draft.isSpoiler}
                  disabled={isBusy}
                  focusId={SPOILER_FOCUS_ID}
                  onChange={(isSpoiler) => updateDraft({ isSpoiler })}
                />

                <DropdownSelect
                  label={t("screenshots_visibility_label")}
                  value={draft.visibility}
                  options={visibilityOptions}
                  disabled={isBusy}
                  focusId={VISIBILITY_FOCUS_ID}
                  onValueChange={(visibility) => updateDraft({ visibility })}
                />
              </>
            )}
          </div>

          <HorizontalFocusGroup
            regionId={ACTIONS_REGION_ID}
            className="screenshot-review-modal__actions"
          >
            {isUploading ? (
              <>
                {canRetry ? (
                  <Button
                    variant="secondary"
                    focusId={RETRY_FOCUS_ID}
                    icon={<ArrowClockwiseIcon size={18} />}
                    onClick={upload}
                  >
                    {t("screenshots_review_retry")}
                  </Button>
                ) : null}
                <Button
                  focusId={NEXT_FOCUS_ID}
                  onClick={() => goToNextFrom(current.clientId)}
                >
                  {t(
                    index >= queue.length - 1
                      ? "screenshots_review_done"
                      : "screenshots_review_next"
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="danger"
                  focusId={DELETE_FOCUS_ID}
                  disabled={isBusy}
                  loading={pendingAction === "delete"}
                  icon={<TrashIcon size={18} />}
                  onClick={() => setIsDeleteConfirmVisible(true)}
                >
                  {t("screenshots_review_delete")}
                </Button>
                <Button
                  variant="secondary"
                  focusId={SKIP_FOCUS_ID}
                  disabled={isBusy}
                  loading={pendingAction === "skip"}
                  icon={<SkipForwardIcon size={18} />}
                  onClick={() => void skip()}
                >
                  {t("screenshots_review_skip")}
                </Button>
                <Button
                  focusId={UPLOAD_FOCUS_ID}
                  disabled={isBusy}
                  loading={pendingAction === "upload"}
                  icon={<CloudArrowUpIcon size={18} />}
                  onClick={upload}
                >
                  {t("screenshots_review_upload")}
                </Button>
              </>
            )}
          </HorizontalFocusGroup>
        </div>
      </VerticalFocusGroup>

      <ConfirmationModal
        visible={isDeleteConfirmVisible}
        backdropClassName="screenshot-review-modal__confirm-backdrop"
        title={t("screenshots_review_delete_title")}
        description={t("screenshots_review_delete_description")}
        confirmLabel={t("screenshots_review_delete")}
        cancelLabel={t("screenshots_cancel")}
        danger
        loading={pendingAction === "delete"}
        onClose={() => setIsDeleteConfirmVisible(false)}
        onConfirm={remove}
      />
    </Modal>
  );
}
