import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ArrowsOutSimpleIcon,
  CloudArrowUpIcon,
  ImageIcon,
  SidebarSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { LocalScreenshot, ScreenshotQuality } from "@types";
import {
  normalizeScreenshotDescription,
  isScreenshotUploadRetryable,
  resolveScreenshotPreferences,
  resolveScreenshotUploadQuality,
} from "@shared";
import { logger } from "@renderer/logger";
import { useReviewDraftSave } from "./use-review-draft-save";
import {
  ReviewFields,
  ReviewUploadStatus,
  SCREENSHOT_QUALITY_LABELS,
  createReviewDraft,
  toUploadOptions,
  type ReviewDraft,
  type ReviewFieldFocusIds,
} from "./review-fields";

import {
  BumperBadge,
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../common";
import { useFocusLayerId } from "../context";
import { ConfirmationModal } from "../modals";
import { IS_DESKTOP } from "../../constants";
import { getPreferredGameAssets, resolveImageSource } from "../../helpers";
import { useNavigationStore, useVirtualKeyboardStore } from "../../stores";
import { NavigationService, type FocusOverrideTarget } from "../../services";
import { formatScreenshotDate } from "../pages/screenshots";
import { MediaViewer } from "../pages/game/media-viewer";
import { useScreenshotDialogPresenceStore } from "../pages/screenshots/screenshot-dialog-presence";
import { ReviewFilmstrip } from "./review-filmstrip";
import { subscribeScreenshotReviewRequests } from "./review-requests";
import {
  useBigPictureToast,
  useIsLayerOnTop,
  useLibrary,
  useNavigation,
  useNavigationScreenActions,
  useUserDetails,
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
const QUALITY_FOCUS_ID = "screenshot-review-quality";
const UPLOAD_FOCUS_ID = "screenshot-review-upload";
const DELETE_FOCUS_ID = "screenshot-review-delete";
const NEXT_FOCUS_ID = "screenshot-review-next";
const RETRY_FOCUS_ID = "screenshot-review-retry";
const DETAILS_TOGGLE_FOCUS_ID = "screenshot-review-details-toggle";
const DETAILS_PANEL_ID = "screenshot-review-details";
const PREVIEW_TARGET: FocusOverrideTarget = {
  type: "item",
  itemId: PREVIEW_FOCUS_ID,
};
const DETAILS_TOGGLE_TARGET: FocusOverrideTarget = {
  type: "item",
  itemId: DETAILS_TOGGLE_FOCUS_ID,
};
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };
const DETAILS_PANEL_WIDTH = 420;
const DETAILS_PANEL_SPRING = {
  type: "spring",
  stiffness: 360,
  damping: 36,
  mass: 0.9,
} as const;
const DETAILS_CONTENT_OFFSET = 40;
const FIELD_FOCUS: ReviewFieldFocusIds = {
  title: TITLE_FOCUS_ID,
  description: DESCRIPTION_FOCUS_ID,
  spoiler: SPOILER_FOCUS_ID,
  visibility: VISIBILITY_FOCUS_ID,
  quality: QUALITY_FOCUS_ID,
};
const FIELD_FOCUS_IDS = new Set(Object.values(FIELD_FOCUS));
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
  quality: ScreenshotQuality | null;
  rightTarget: FocusOverrideTarget;
  downTarget: FocusOverrideTarget;
  onOpenFullscreen: () => void;
}

function ReviewPreview({
  screenshot,
  gameTitle,
  quality,
  rightTarget,
  downTarget,
  onOpenFullscreen,
}: Readonly<ReviewPreviewProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const source = screenshot
    ? resolveImageSource(screenshot.previewPath ?? screenshot.path)
    : "";
  const hasImage = Boolean(source) && screenshot?.path !== failedPath;
  const alt = t("screenshots_review_preview_alt", { game: gameTitle });
  const openLabel = t("open_screenshot", { ns: "screenshots" });
  const openFullscreen = () => {
    if (hasImage) onOpenFullscreen();
  };

  return (
    <>
      <FocusItem
        id={PREVIEW_FOCUS_ID}
        actions={{ primary: openFullscreen }}
        navigationState={hasImage ? "active" : "disabled"}
        navigationOverrides={{
          up: BLOCK_TARGET,
          down: downTarget,
          left: BLOCK_TARGET,
          right: rightTarget,
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
          {hasImage && quality ? (
            <span
              className={cn("screenshot-review-modal__quality", {
                "screenshot-review-modal__quality--cloud": quality === "CLOUD",
              })}
            >
              {SCREENSHOT_QUALITY_LABELS[quality]}
            </span>
          ) : null}
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
    </>
  );
}

const RECORD_RETRY_FOCUS_ID = "screenshot-review-record-retry";

function ReviewRecordStatus({
  hasFailed,
  upTarget,
  onRetry,
}: Readonly<{
  hasFailed: boolean;
  upTarget: FocusOverrideTarget;
  onRetry: () => void;
}>) {
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
          focusNavigationOverrides={{
            left: DETAILS_TOGGLE_TARGET,
            up: upTarget,
          }}
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
  upTarget: FocusOverrideTarget;
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
  upTarget,
  onRetry,
  onNext,
  onDelete,
  onUpload,
}: Readonly<ReviewActionsProps>) {
  const { t } = useTranslation("big_picture");

  if (isUploading) {
    return (
      <div className="screenshot-review-modal__actions">
        {canRetry ? (
          <Button
            variant="secondary"
            focusId={RETRY_FOCUS_ID}
            focusNavigationOverrides={{
              left: DETAILS_TOGGLE_TARGET,
              up: upTarget,
            }}
            icon={<ArrowClockwiseIcon size={18} />}
            onClick={onRetry}
          >
            {t("screenshots_review_retry")}
          </Button>
        ) : null}
        <Button
          focusId={NEXT_FOCUS_ID}
          focusNavigationOverrides={{
            left: canRetry
              ? { type: "item", itemId: RETRY_FOCUS_ID }
              : DETAILS_TOGGLE_TARGET,
            right: BLOCK_TARGET,
            up: upTarget,
          }}
          onClick={onNext}
        >
          {t(
            isLastItem ? "screenshots_review_done" : "screenshots_review_next"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="screenshot-review-modal__actions">
      <Button
        focusId={UPLOAD_FOCUS_ID}
        focusNavigationOverrides={{
          left: DETAILS_TOGGLE_TARGET,
          right: { type: "item", itemId: DELETE_FOCUS_ID },
          up: upTarget,
        }}
        disabled={isBusy || !isRecordReady}
        loading={pendingAction === "upload"}
        icon={<CloudArrowUpIcon size={18} />}
        onClick={onUpload}
      >
        {t("screenshots_review_upload")}
      </Button>
      <Button
        variant="danger"
        size="icon"
        focusId={DELETE_FOCUS_ID}
        focusNavigationOverrides={{
          left: { type: "item", itemId: UPLOAD_FOCUS_ID },
          right: BLOCK_TARGET,
          up: upTarget,
        }}
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
    </div>
  );
}

function ReviewDetailsShortcut({
  enabled,
  onToggle,
}: Readonly<{ enabled: boolean; onToggle: () => void }>) {
  const layerId = useFocusLayerId();
  const isOnTop = useIsLayerOnTop(layerId);
  const isVirtualKeyboardOpen = useVirtualKeyboardStore(
    (state) => state.target !== null
  );
  const actions = useMemo(
    () =>
      enabled && isOnTop && !isVirtualKeyboardOpen
        ? { press: { y: onToggle } }
        : {},
    [enabled, isOnTop, isVirtualKeyboardOpen, onToggle]
  );
  useNavigationScreenActions(actions);

  return null;
}

export { requestScreenshotReview } from "./review-requests";

function useMissingScreenshotsToast() {
  const { t } = useTranslation("screenshots_capture");
  const { showErrorToast } = useBigPictureToast();

  useEffect(() => {
    if (!IS_DESKTOP) return;

    return globalThis.window.electron.onLocalScreenshotsMissing((count) => {
      if (document.visibilityState !== "visible") return;
      showErrorToast(t("missing_files_title"), {
        message: t("missing_files_body", { count }),
        fallbackVisual: "settings",
      });
    });
  }, [showErrorToast, t]);
}

export function ScreenshotReviewModal() {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const { showErrorToast } = useBigPictureToast();
  useMissingScreenshotsToast();
  const { setFocus } = useNavigation();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const [queueState, setQueueState] =
    useState<ReviewQueueState>(EMPTY_REVIEW_QUEUE);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [pendingAction, setPendingAction] = useState<ReviewDecision | null>(
    null
  );
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { library } = useLibrary();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const prefersReducedMotion = useReducedMotion();
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

    return subscribeScreenshotReviewRequests((request) => {
      setQueueState((current) => enqueueReviewRequest(current, request));
    });
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
    setIsDetailsOpen(false);
    setIsFullscreen(false);
  }, [flushDraftSaves, visible]);

  const toggleDetails = useCallback(() => {
    const focusId = NavigationService.getInstance().getCurrentFocusId();
    if (focusId && FIELD_FOCUS_IDS.has(focusId)) {
      setFocus(DETAILS_TOGGLE_FOCUS_ID);
    }
    setIsDetailsOpen((isOpen) => !isOpen);
  }, [setFocus]);

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
      const wasRemoved =
        action === "upload" &&
        (result as LocalScreenshot | null)?.state === "deleted";
      if (action === "upload" && !result) {
        showErrorToast(t("screenshots_settings_sign_in_to_upload"), {
          fallbackVisual: "settings",
        });
        return false;
      }
      setQueueState((state) =>
        recordReviewDecision(
          state,
          current.clientId,
          wasRemoved ? "delete" : action
        )
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
    if (!userDetails) {
      showErrorToast(t("screenshots_sign_in_to_upload"), {
        fallbackVisual: "settings",
      });
      return;
    }

    cancelDraftSave(current.clientId);

    void runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(
        current.clientId,
        toUploadOptions(draft, isCustomGame, hasActiveSubscription)
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
  const isSidePanelOpen = isDetailsOpen && !isUploading;
  const uploadQuality = resolveScreenshotUploadQuality(
    draft.quality,
    hasActiveSubscription
  );
  const previewQuality = isUploading
    ? (currentScreenshot?.uploadQuality ?? uploadQuality)
    : uploadQuality;
  const getFooterEntryFocusId = () => {
    if (!isRecordReady) {
      return hasLoadFailed ? RECORD_RETRY_FOCUS_ID : DETAILS_TOGGLE_FOCUS_ID;
    }
    if (isUploading) return canRetry ? RETRY_FOCUS_ID : NEXT_FOCUS_ID;
    return UPLOAD_FOCUS_ID;
  };
  const sideEntryTarget: FocusOverrideTarget = isSidePanelOpen
    ? {
        type: "item",
        itemId: isCustomGame ? TITLE_FOCUS_ID : DESCRIPTION_FOCUS_ID,
      }
    : BLOCK_TARGET;
  const footerUpTarget: FocusOverrideTarget = isSidePanelOpen
    ? { type: "item", itemId: QUALITY_FOCUS_ID }
    : PREVIEW_TARGET;
  const visibleItems = getVisibleReviewItems(queueState);
  const fullscreenItems = visibleItems.flatMap((item) => {
    const itemScreenshot = screenshots.find(
      (candidate) => candidate.clientId === item.clientId
    );
    if (!itemScreenshot) return [];
    return [
      {
        id: itemScreenshot.clientId,
        type: "image" as const,
        src: resolveImageSource(itemScreenshot.path),
        alt: t("screenshots_review_preview_alt", {
          game: itemScreenshot.gameTitle,
        }),
      },
    ];
  });
  const fullscreenIndex = fullscreenItems.findIndex(
    (item) => item.id === current?.clientId
  );
  const visiblePosition = visibleItems.findIndex(
    (item) => item.clientId === current.clientId
  );
  const libraryGame = currentScreenshot
    ? library.find(
        (game) =>
          game.shop === currentScreenshot.shop &&
          game.objectId === currentScreenshot.objectId
      )
    : undefined;
  const gameIconUrl = getPreferredGameAssets(libraryGame, null).iconUrl;
  const gameIconSource = gameIconUrl ? resolveImageSource(gameIconUrl) : "";
  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : DETAILS_PANEL_SPRING;
  const contentTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };
  const detailsLabel = t(
    isSidePanelOpen
      ? "screenshots_review_hide_details"
      : "screenshots_review_show_details"
  );

  return (
    <Modal
      visible={visible}
      title={gameTitle}
      headerContent={
        <div className="screenshot-review-modal__header-game">
          {gameIconSource ? (
            <img
              className="screenshot-review-modal__header-icon"
              src={gameIconSource}
              alt=""
              draggable={false}
            />
          ) : null}
          <h4>{gameTitle}</h4>
          {visibleItems.length > 1 ? (
            <span className="screenshot-review-modal__header-position">
              {t("screenshots_review_position", {
                current: visiblePosition + 1,
                total: visibleItems.length,
              })}
            </span>
          ) : null}
        </div>
      }
      onClose={close}
      closeOnBackdrop={false}
      closeOnB={!isBusy}
      closeOnEscape={!isBusy}
      initialFocusId={UPLOAD_FOCUS_ID}
      className="screenshot-review-modal"
      backdropClassName="screenshot-review-modal__backdrop"
    >
      <ReviewDetailsShortcut
        enabled={!isUploading && !isDeleteConfirmVisible}
        onToggle={toggleDetails}
      />
      <VerticalFocusGroup regionId={REGION_ID} asChild>
        <div className="screenshot-review-modal__content">
          <div className="screenshot-review-modal__media">
            <ReviewPreview
              key={current.clientId}
              screenshot={currentScreenshot}
              gameTitle={gameTitle}
              quality={previewQuality}
              rightTarget={sideEntryTarget}
              downTarget={{ type: "item", itemId: getFooterEntryFocusId() }}
              onOpenFullscreen={() => setIsFullscreen(true)}
            />
            {isFullscreen && fullscreenItems.length > 0 ? (
              <MediaViewer
                items={fullscreenItems}
                index={Math.max(fullscreenIndex, 0)}
                className="screenshot-review-modal__viewer"
                showFilmstrip={false}
                showCounter={false}
                onNavigate={(nextIndex) => {
                  const next = fullscreenItems[nextIndex];
                  if (next) selectScreenshot(next.id);
                }}
                onClose={() => setIsFullscreen(false)}
              />
            ) : null}
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

          <AnimatePresence initial={false}>
            {isSidePanelOpen ? (
              <motion.div
                key="details"
                id={DETAILS_PANEL_ID}
                className="screenshot-review-modal__side"
                initial={{ width: 0 }}
                animate={{ width: DETAILS_PANEL_WIDTH }}
                exit={{ width: 0 }}
                transition={panelTransition}
              >
                <VerticalFocusGroup regionId={SIDE_REGION_ID} asChild>
                  <motion.div
                    ref={fieldsRef}
                    className="screenshot-review-modal__fields"
                    style={{ width: DETAILS_PANEL_WIDTH }}
                    initial={{ opacity: 0, x: DETAILS_CONTENT_OFFSET }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: DETAILS_CONTENT_OFFSET }}
                    transition={contentTransition}
                  >
                    <ReviewFields
                      clientId={current.clientId}
                      draft={draft}
                      isCustomGame={isCustomGame}
                      disabled={isLocked}
                      focusIds={FIELD_FOCUS}
                      leftTarget={PREVIEW_TARGET}
                      downTarget={{
                        type: "item",
                        itemId: getFooterEntryFocusId(),
                      }}
                      onChange={updateDraft}
                    />
                  </motion.div>
                </VerticalFocusGroup>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <HorizontalFocusGroup regionId={ACTIONS_REGION_ID} asChild>
            <footer className="screenshot-review-modal__footer">
              <Button
                variant="secondary"
                focusId={DETAILS_TOGGLE_FOCUS_ID}
                focusNavigationOverrides={{
                  left: BLOCK_TARGET,
                  up: footerUpTarget,
                }}
                disabled={isUploading}
                icon={<SidebarSimpleIcon size={18} mirrored />}
                aria-expanded={isSidePanelOpen}
                aria-controls={DETAILS_PANEL_ID}
                className="screenshot-review-modal__details-toggle"
                onClick={toggleDetails}
              >
                {detailsLabel}
                <BumperBadge
                  label="Y"
                  className="screenshot-review-modal__shortcut"
                />
              </Button>

              <div className="screenshot-review-modal__footer-status">
                {isRecordReady ? null : (
                  <ReviewRecordStatus
                    hasFailed={hasLoadFailed}
                    upTarget={footerUpTarget}
                    onRetry={retryLoad}
                  />
                )}
                {isRecordReady && isUploading ? (
                  <ReviewUploadStatus screenshot={currentScreenshot} />
                ) : null}
              </div>

              <ReviewActions
                isUploading={isUploading}
                canRetry={canRetry}
                isLastItem={!hasOtherUndecidedReviewItems(queueState)}
                isBusy={isBusy}
                isRecordReady={isRecordReady}
                pendingAction={pendingAction}
                upTarget={footerUpTarget}
                onRetry={upload}
                onNext={() => goToNextFrom(current.clientId)}
                onDelete={() => setIsDeleteConfirmVisible(true)}
                onUpload={upload}
              />
            </footer>
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
