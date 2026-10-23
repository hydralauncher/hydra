import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ArrowsOutSimpleIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ImageIcon,
  PencilSimpleIcon,
  PlusIcon,
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
  FocusItem,
  HorizontalFocusGroup,
  Modal,
  SegmentedControl,
  VerticalFocusGroup,
  type SegmentedControlOption,
} from "../common";
import { ConfirmationModal } from "../modals";
import { IS_DESKTOP } from "../../constants";
import { resolveImageSource } from "../../helpers";
import { useNavigationStore } from "../../stores";
import type { FocusOverrideTarget } from "../../services";
import {
  formatScreenshotDate,
  getLocalScreenshotStatusDetail,
} from "../pages/screenshots";
import { MediaViewer } from "../pages/game/media-viewer";
import { InlineTextField } from "../pages/screenshots/inline-text-field";
import { useScreenshotDialogPresenceStore } from "../pages/screenshots/screenshot-dialog-presence";
import { ReviewFilmstrip } from "./review-filmstrip";
import { subscribeScreenshotReviewRequests } from "./review-requests";
import {
  useBigPictureToast,
  useNavigation,
  useUserPreferences,
} from "../../hooks";
import {
  EMPTY_REVIEW_QUEUE,
  advanceReviewQueuePast,
  getVisibleReviewItems,
  hasOtherUndecidedReviewItems,
  selectReviewItem,
  stepReviewQueue,
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
const SIDE_REGION_ID = "screenshot-review-modal-side";
const TITLE_FOCUS_ID = "screenshot-review-title";
const DESCRIPTION_FOCUS_ID = "screenshot-review-description";
const PREVIEW_FOCUS_ID = "screenshot-review-preview";
const SPOILER_FOCUS_ID = "screenshot-review-spoiler";
const VISIBILITY_FOCUS_ID = "screenshot-review-visibility";
const UPLOAD_FOCUS_ID = "screenshot-review-upload";
const DELETE_FOCUS_ID = "screenshot-review-delete";
const NEXT_FOCUS_ID = "screenshot-review-next";
const RETRY_FOCUS_ID = "screenshot-review-retry";
const PREVIEW_TARGET: FocusOverrideTarget = {
  type: "item",
  itemId: PREVIEW_FOCUS_ID,
};
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };
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
    if (screenshot.moderationStatus === "BLOCKED")
      return "screenshots_review_upload_blocked";
    return screenshot.moderationStatus === "APPROVED"
      ? "screenshots:uploaded"
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
  const [hasLoadFailed, setHasLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const retryLoad = useCallback(() => {
    setHasLoadFailed(false);
    setReloadToken((current) => current + 1);
  }, []);

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
        setHasLoadFailed(false);
        setLoadedRequestCount(requestCount);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots", error);
        if (isCurrent) setHasLoadFailed(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [isActive, reloadToken, requestCount]);

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

  return { screenshots, loadedRequestCount, hasLoadFailed, retryLoad };
}

const releaseUndecidedScreenshots = (clientIds: string[]) => {
  if (!clientIds.length) return;
  void globalThis.window.electron
    .releaseBigPictureScreenshotReview(clientIds)
    .catch((error: unknown) => {
      logger.error("Failed to release the reviewed screenshots", error);
    });
};

interface ReviewPreviewProps {
  screenshot: LocalScreenshot | undefined;
  gameTitle: string;
  rightFocusId: string;
}

function ReviewPreview({
  screenshot,
  gameTitle,
  rightFocusId,
}: Readonly<ReviewPreviewProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const source = screenshot
    ? resolveImageSource(screenshot.previewPath ?? screenshot.path)
    : "";
  const hasImage = Boolean(source) && screenshot?.path !== failedPath;
  const alt = t("screenshots_review_preview_alt", { game: gameTitle });
  const openLabel = t("open_screenshot", { ns: "screenshots" });
  const fullscreenItems = useMemo(
    () =>
      screenshot
        ? [
            {
              id: screenshot.clientId,
              type: "image" as const,
              src: resolveImageSource(screenshot.path),
              alt,
            },
          ]
        : [],
    [alt, screenshot]
  );
  const openFullscreen = () => {
    if (hasImage) setIsFullscreen(true);
  };

  return (
    <>
      <FocusItem
        id={PREVIEW_FOCUS_ID}
        actions={{ primary: openFullscreen }}
        navigationState={hasImage ? "active" : "disabled"}
        navigationOverrides={{
          up: BLOCK_TARGET,
          down: BLOCK_TARGET,
          left: BLOCK_TARGET,
          right: { type: "item", itemId: rightFocusId },
        }}
        asChild
      >
        <button
          type="button"
          className="screenshot-review-modal__preview"
          disabled={!hasImage}
          aria-label={openLabel}
          title={openLabel}
          onClick={openFullscreen}
        >
          {hasImage ? (
            <img
              src={source}
              alt={alt}
              draggable={false}
              onError={() => setFailedPath(screenshot?.path ?? null)}
            />
          ) : (
            <ImageIcon size={48} />
          )}
          {hasImage ? (
            <span className="screenshot-review-modal__expand" aria-hidden>
              <ArrowsOutSimpleIcon size={18} weight="bold" />
            </span>
          ) : null}
          {screenshot ? (
            <time
              className="screenshot-review-modal__date"
              dateTime={new Date(screenshot.capturedAt).toISOString()}
            >
              {formatScreenshotDate(screenshot.capturedAt, language)}
            </time>
          ) : null}
        </button>
      </FocusItem>

      {isFullscreen && fullscreenItems.length > 0 ? (
        <MediaViewer
          items={fullscreenItems}
          index={0}
          className="screenshot-review-modal__viewer"
          showFilmstrip={false}
          showCounter={false}
          onNavigate={() => undefined}
          onClose={() => setIsFullscreen(false)}
        />
      ) : null}
    </>
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

const RECORD_RETRY_FOCUS_ID = "screenshot-review-record-retry";

function ReviewRecordStatus({
  hasFailed,
  onRetry,
}: Readonly<{ hasFailed: boolean; onRetry: () => void }>) {
  const { t } = useTranslation("big_picture");

  return (
    <output className="screenshot-review-modal__record-status">
      <span>
        {t(hasFailed ? "screenshots_load_failed" : "screenshots_loading")}
      </span>
      {hasFailed ? (
        <Button
          variant="secondary"
          size="small"
          focusId={RECORD_RETRY_FOCUS_ID}
          focusNavigationOverrides={{ left: PREVIEW_TARGET }}
          icon={<ArrowClockwiseIcon size={18} />}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      ) : null}
    </output>
  );
}

interface ReviewActionsProps {
  isUploading: boolean;
  canRetry: boolean;
  isLastItem: boolean;
  isBusy: boolean;
  isRecordReady: boolean;
  pendingAction: ReviewDecision | null;
  onRetry: () => void;
  onNext: () => void;
  onDelete: () => void;
  onUpload: () => void;
}

function ReviewActions({
  isUploading,
  canRetry,
  isLastItem,
  isBusy,
  isRecordReady,
  pendingAction,
  onRetry,
  onNext,
  onDelete,
  onUpload,
}: Readonly<ReviewActionsProps>) {
  const { t } = useTranslation("big_picture");

  return (
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
              focusNavigationOverrides={{ left: PREVIEW_TARGET }}
              icon={<ArrowClockwiseIcon size={18} />}
              onClick={onRetry}
            >
              {t("screenshots_review_retry")}
            </Button>
          ) : null}
          <Button
            focusId={NEXT_FOCUS_ID}
            focusNavigationOverrides={
              canRetry
                ? { left: { type: "item", itemId: RETRY_FOCUS_ID } }
                : { left: PREVIEW_TARGET }
            }
            onClick={onNext}
          >
            {t(
              isLastItem ? "screenshots_review_done" : "screenshots_review_next"
            )}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="danger"
            size="icon"
            focusId={DELETE_FOCUS_ID}
            focusNavigationOverrides={{ left: PREVIEW_TARGET }}
            disabled={isBusy}
            loading={pendingAction === "delete"}
            icon={<TrashIcon size={20} />}
            aria-label={t("screenshots_review_delete")}
            title={t("screenshots_review_delete")}
            className="screenshot-review-modal__delete"
            onClick={onDelete}
          >
            {null}
          </Button>
          <Button
            focusId={UPLOAD_FOCUS_ID}
            disabled={isBusy || !isRecordReady}
            loading={pendingAction === "upload"}
            icon={<CloudArrowUpIcon size={18} />}
            onClick={onUpload}
          >
            {t("screenshots_review_upload")}
          </Button>
        </>
      )}
    </HorizontalFocusGroup>
  );
}

const createReviewDraft = (
  record: LocalScreenshot | undefined,
  defaultVisibility: ProfileVisibility
): ReviewDraft => ({
  isSpoiler: record?.isSpoiler ?? false,
  visibility: record?.visibility ?? defaultVisibility,
  customGameTitle: record?.customGameTitle ?? "",
  description: record?.description ?? "",
});

const toUploadOptions = (draft: ReviewDraft, isCustomGame: boolean) => {
  const customGameTitle = draft.customGameTitle.trim();

  return {
    isSpoiler: draft.isSpoiler,
    visibility: draft.visibility,
    customGameTitle: isCustomGame && customGameTitle ? customGameTitle : null,
    description: normalizeScreenshotDescription(draft.description),
  };
};

export { requestScreenshotReview } from "./review-requests";

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
    cancel: cancelDraftSave,
    flushAll: flushDraftSaves,
  } = useReviewDraftSave();
  const fieldsRef = useRef<HTMLDivElement | null>(null);
  const queueGenerationRef = useRef(0);
  const isQueueOpen = isReviewQueueOpen(queueState);
  const isScreenshotDialogOpen = useScreenshotDialogPresenceStore(
    (state) => state.openCount > 0
  );
  const [isPresented, setIsPresented] = useState(false);
  const visible = isQueueOpen && isPresented;

  useEffect(
    () => () => {
      queueGenerationRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (!isQueueOpen) setIsPresented(false);
    else if (!isScreenshotDialogOpen) setIsPresented(true);
  }, [isQueueOpen, isScreenshotDialogOpen]);
  const { screenshots, loadedRequestCount, hasLoadFailed, retryLoad } =
    useLocalScreenshots(visible, queueState.requestCount);
  const isListFresh = isReviewListFresh(queueState, loadedRequestCount);
  const { index, decisions } = queueState;
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
    const unsubscribeLocal = subscribeScreenshotReviewRequests(enqueue);

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
      unsubscribeLocal();
    };
  }, []);

  const current = getCurrentReviewItem(queueState);
  const currentScreenshot = useMemo(
    () => screenshots.find((item) => item.clientId === current?.clientId),
    [current?.clientId, screenshots]
  );
  const decision = current ? decisions[current.clientId] : undefined;
  const isRecordReady = Boolean(currentScreenshot);
  const isCustomGame = current?.shop === "custom";
  const draft: ReviewDraft =
    (current && drafts[current.clientId]) ??
    createReviewDraft(currentScreenshot, defaultVisibilityRef.current);

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

  const selectScreenshot = useCallback(
    (clientId: string) => {
      flushDraftSaves();
      setQueueState((state) => selectReviewItem(state, clientId));
    },
    [flushDraftSaves]
  );

  const stepScreenshot = useCallback(
    (direction: -1 | 1) => {
      flushDraftSaves();
      setQueueState((state) => stepReviewQueue(state, direction));
    },
    [flushDraftSaves]
  );

  useEffect(() => {
    if (!visible) return;

    if (!isRecordReady && !hasLoadFailed) return;
    const readyFocusId =
      decision === "upload" ? NEXT_FOCUS_ID : UPLOAD_FOCUS_ID;
    const focusId = isRecordReady ? readyFocusId : RECORD_RETRY_FOCUS_ID;
    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(focusId);
      globalThis.document
        .getElementById(focusId)
        ?.scrollIntoView({ block: "nearest" });

      const fields = fieldsRef.current;
      if (fields) fields.scrollTop = fields.scrollHeight;
    });

    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [decision, hasLoadFailed, index, isRecordReady, setFocus, visible]);

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

    releaseUndecidedScreenshots(droppedIds);
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
    if (!current || !currentScreenshot) return;

    cancelDraftSave(current.clientId);

    void runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(
        current.clientId,
        toUploadOptions(draft, isCustomGame)
      )
    );
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
    if (pendingAction) return;
    queueGenerationRef.current += 1;
    releaseUndecidedScreenshots(getUndecidedReviewIds(queueState));
    setQueueState(closeReviewQueue);
  };

  const visibilityOptions = useMemo<
    SegmentedControlOption<ProfileVisibility>[]
  >(
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
  const isLocked = isBusy || !isRecordReady;
  const getSideEntryFocusId = () => {
    if (!isRecordReady) return RECORD_RETRY_FOCUS_ID;
    if (isUploading) return canRetry ? RETRY_FOCUS_ID : NEXT_FOCUS_ID;
    if (isCustomGame) return TITLE_FOCUS_ID;
    return DESCRIPTION_FOCUS_ID;
  };
  const visibleItems = getVisibleReviewItems(queueState);
  const visiblePosition = visibleItems.findIndex(
    (item) => item.clientId === current.clientId
  );

  return (
    <Modal
      visible={visible}
      title={t("screenshots_review_title")}
      description={t("screenshots_review_counter", {
        current: visiblePosition + 1,
        total: visibleItems.length,
      })}
      onClose={close}
      closeOnBackdrop={false}
      closeOnB={!isBusy}
      closeOnEscape={!isBusy}
      initialFocusId={UPLOAD_FOCUS_ID}
      className="screenshot-review-modal"
      backdropClassName="screenshot-review-modal__backdrop"
    >
      <HorizontalFocusGroup regionId={REGION_ID} asChild>
        <div className="screenshot-review-modal__content">
          <div className="screenshot-review-modal__media">
            <ReviewPreview
              key={current.clientId}
              screenshot={currentScreenshot}
              gameTitle={gameTitle}
              rightFocusId={getSideEntryFocusId()}
            />
            <ReviewFilmstrip
              items={visibleItems}
              screenshots={screenshots}
              decisions={decisions}
              currentClientId={current.clientId}
              isLocked={isBusy || isDeleteConfirmVisible}
              onSelect={selectScreenshot}
              onStep={stepScreenshot}
            />
          </div>

          <VerticalFocusGroup regionId={SIDE_REGION_ID} asChild>
            <div className="screenshot-review-modal__side">
              <div className="screenshot-review-modal__heading">
                {isCustomGame ? (
                  <InlineTextField
                    key={current.clientId}
                    focusId={TITLE_FOCUS_ID}
                    navigationOverrides={{ left: PREVIEW_TARGET }}
                    className="screenshot-review-modal__title-field"
                    label={t("screenshots_custom_title_label")}
                    value={draft.customGameTitle.trim()}
                    placeholder={t("screenshots_custom_game")}
                    icon={<PencilSimpleIcon size={18} />}
                    maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
                    allowEmpty
                    disabled={isUploading || isLocked}
                    onSave={(customGameTitle) => {
                      updateDraft({ customGameTitle });
                      return true;
                    }}
                  />
                ) : (
                  <p className="screenshot-review-modal__game">{gameTitle}</p>
                )}
              </div>

              <div className="screenshot-review-modal__form">
                <div
                  ref={fieldsRef}
                  className="screenshot-review-modal__fields"
                >
                  {isRecordReady ? null : (
                    <ReviewRecordStatus
                      hasFailed={hasLoadFailed}
                      onRetry={retryLoad}
                    />
                  )}
                  {isUploading ? (
                    <UploadStatus screenshot={currentScreenshot} />
                  ) : (
                    <>
                      <InlineTextField
                        key={`description:${current.clientId}`}
                        focusId={DESCRIPTION_FOCUS_ID}
                        navigationOverrides={{ left: PREVIEW_TARGET }}
                        className="screenshot-review-modal__description-field"
                        label={t("screenshots_description_label")}
                        value={draft.description}
                        placeholder={t("screenshots_add_description")}
                        icon={<PlusIcon size={18} weight="bold" />}
                        maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
                        allowEmpty
                        disabled={isLocked}
                        sanitize={sanitizeScreenshotDescriptionInput}
                        onSave={(description) => {
                          updateDraft({ description });
                          return true;
                        }}
                      />

                      <Checkbox
                        block
                        label={t("screenshots_mark_spoiler")}
                        secondaryText={t(
                          "screenshots_mark_spoiler_description"
                        )}
                        checked={draft.isSpoiler}
                        disabled={isLocked}
                        focusId={SPOILER_FOCUS_ID}
                        navigationOverrides={{
                          up: { type: "item", itemId: DESCRIPTION_FOCUS_ID },
                          down: { type: "item", itemId: VISIBILITY_FOCUS_ID },
                          left: PREVIEW_TARGET,
                        }}
                        onChange={(isSpoiler) => updateDraft({ isSpoiler })}
                      />

                      <SegmentedControl
                        label={t("screenshots_visibility_label")}
                        value={draft.visibility}
                        options={visibilityOptions}
                        disabled={isLocked}
                        focusId={VISIBILITY_FOCUS_ID}
                        navigationOverrides={{
                          up: { type: "item", itemId: SPOILER_FOCUS_ID },
                          down: { type: "item", itemId: UPLOAD_FOCUS_ID },
                          left: PREVIEW_TARGET,
                        }}
                        onValueChange={(visibility) =>
                          updateDraft({ visibility })
                        }
                      />
                    </>
                  )}
                </div>

                <ReviewActions
                  isUploading={isUploading}
                  canRetry={canRetry}
                  isLastItem={!hasOtherUndecidedReviewItems(queueState)}
                  isBusy={isBusy}
                  isRecordReady={isRecordReady}
                  pendingAction={pendingAction}
                  onRetry={upload}
                  onNext={() => goToNextFrom(current.clientId)}
                  onDelete={() => setIsDeleteConfirmVisible(true)}
                  onUpload={upload}
                />
              </div>
            </div>
          </VerticalFocusGroup>
        </div>
      </HorizontalFocusGroup>

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
