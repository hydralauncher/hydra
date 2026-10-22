import "./styles.scss";

import {
  ArrowClockwiseIcon,
  CaretUpIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  HardDrivesIcon,
  ImageIcon,
  PencilSimpleIcon,
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
  ContextMenu,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
  type ContextMenuItem,
  type DropdownSelectOption,
} from "../common";
import { ConfirmationModal } from "../modals";
import { IS_DESKTOP } from "../../constants";
import { resolveImageSource } from "../../helpers";
import { useNavigationStore } from "../../stores";
import {
  formatScreenshotDate,
  getLocalScreenshotStatusDetail,
} from "../pages/screenshots";
import { InlineTextField } from "../pages/screenshots/inline-text-field";
import { useScreenshotDialogPresenceStore } from "../pages/screenshots/screenshot-dialog-presence";
import { subscribeScreenshotReviewRequests } from "./review-requests";
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
const SKIP_MENU_FOCUS_ID = "screenshot-review-skip-menu";
const UPLOAD_MENU_FOCUS_ID = "screenshot-review-upload-menu";
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
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
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
      {screenshot ? (
        <time
          className="screenshot-review-modal__date"
          dateTime={new Date(screenshot.capturedAt).toISOString()}
        >
          {formatScreenshotDate(screenshot.capturedAt, language)}
        </time>
      ) : null}
    </div>
  );
}

interface ReviewMenuAction {
  label: string;
  onSelect: () => void;
}

interface ReviewSplitButtonProps {
  focusId: string;
  menuFocusId: string;
  menuLabel: string;
  variant?: "primary" | "secondary";
  icon: React.ReactNode;
  disabled: boolean;
  loading: boolean;
  menuAction: ReviewMenuAction | null;
  children: React.ReactNode;
  onClick: () => void;
}

function ReviewSplitButton({
  focusId,
  menuFocusId,
  menuLabel,
  variant = "primary",
  icon,
  disabled,
  loading,
  menuAction,
  children,
  onClick,
}: Readonly<ReviewSplitButtonProps>) {
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const toggleRef = useRef<HTMLSpanElement | null>(null);
  const menuItems: ContextMenuItem[] = menuAction
    ? [
        {
          id: menuFocusId,
          label: menuAction.label,
          onSelect: menuAction.onSelect,
        },
      ]
    : [];

  return (
    <span className="screenshot-review-modal__split">
      <Button
        variant={variant}
        focusId={focusId}
        disabled={disabled}
        loading={loading}
        icon={icon}
        className="screenshot-review-modal__split-main"
        onClick={onClick}
      >
        {children}
      </Button>
      {menuAction ? (
        <span ref={toggleRef} className="screenshot-review-modal__split-toggle">
          <Button
            variant={variant}
            size="icon"
            focusId={menuFocusId}
            disabled={disabled}
            icon={<CaretUpIcon size={16} weight="bold" />}
            aria-label={menuLabel}
            title={menuLabel}
            onClick={() => {
              const rect = toggleRef.current?.getBoundingClientRect();
              setMenuPosition({
                x: (rect?.right ?? 0) - 240,
                y: (rect?.top ?? 0) - 64,
              });
            }}
          >
            {null}
          </Button>
        </span>
      ) : null}
      <ContextMenu
        items={menuItems}
        visible={menuPosition !== null}
        position={menuPosition ?? { x: 0, y: 0 }}
        restoreFocusId={menuFocusId}
        ariaLabel={menuLabel}
        onClose={() => setMenuPosition(null)}
      />
    </span>
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

interface ReviewActionsProps {
  isUploading: boolean;
  canRetry: boolean;
  isLastItem: boolean;
  isBusy: boolean;
  pendingAction: ReviewDecision | null;
  undecidedCount: number;
  onRetry: () => void;
  onNext: () => void;
  onDelete: () => void;
  onKeep: () => void;
  onKeepAll: () => void;
  onUpload: () => void;
  onUploadAll: () => void;
}

function ReviewActions({
  isUploading,
  canRetry,
  isLastItem,
  isBusy,
  pendingAction,
  undecidedCount,
  onRetry,
  onNext,
  onDelete,
  onKeep,
  onKeepAll,
  onUpload,
  onUploadAll,
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
              icon={<ArrowClockwiseIcon size={18} />}
              onClick={onRetry}
            >
              {t("screenshots_review_retry")}
            </Button>
          ) : null}
          <Button focusId={NEXT_FOCUS_ID} onClick={onNext}>
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
          <ReviewSplitButton
            focusId={SKIP_FOCUS_ID}
            menuFocusId={SKIP_MENU_FOCUS_ID}
            menuLabel={t("keep_more_options", {
              ns: "screenshots_capture",
            })}
            variant="secondary"
            icon={<HardDrivesIcon size={18} />}
            disabled={isBusy}
            loading={pendingAction === "skip"}
            menuAction={
              undecidedCount > 1
                ? {
                    label: t("keep_all", {
                      ns: "screenshots_capture",
                      count: undecidedCount,
                    }),
                    onSelect: onKeepAll,
                  }
                : null
            }
            onClick={onKeep}
          >
            {t("keep_on_computer", { ns: "screenshots_capture" })}
          </ReviewSplitButton>
          <ReviewSplitButton
            focusId={UPLOAD_FOCUS_ID}
            menuFocusId={UPLOAD_MENU_FOCUS_ID}
            menuLabel={t("upload_more_options", {
              ns: "screenshots_capture",
            })}
            icon={<CloudArrowUpIcon size={18} />}
            disabled={isBusy}
            loading={pendingAction === "upload"}
            menuAction={
              undecidedCount > 1
                ? {
                    label: t("upload_all", {
                      ns: "screenshots_capture",
                      count: undecidedCount,
                    }),
                    onSelect: onUploadAll,
                  }
                : null
            }
            onClick={onUpload}
          >
            {t("screenshots_review_upload")}
          </ReviewSplitButton>
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
  const isCustomGame = current?.shop === "custom";
  const draft: ReviewDraft =
    (current && drafts[current.clientId]) ??
    createReviewDraft(currentScreenshot, defaultVisibilityRef.current);

  const getDraftFor = (clientId: string): ReviewDraft =>
    drafts[clientId] ??
    createReviewDraft(
      screenshots.find((item) => item.clientId === clientId),
      defaultVisibilityRef.current
    );

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

    cancelDraftSave(current.clientId);

    void runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(
        current.clientId,
        toUploadOptions(draft, isCustomGame)
      )
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

  const keepAll = () => {
    flushDraftSaves();
    close();
  };

  const uploadAll = async () => {
    if (pendingAction) return;

    const pendingIds = getUndecidedReviewIds(queueState);
    setPendingAction("upload");

    try {
      for (const clientId of pendingIds) {
        const item = queueState.items.find(
          (entry) => entry.clientId === clientId
        );
        cancelDraftSave(clientId);

        const queued = await globalThis.window.electron.uploadLocalScreenshot(
          clientId,
          toUploadOptions(getDraftFor(clientId), item?.shop === "custom")
        );
        if (!queued) {
          showErrorToast(t("screenshots_settings_sign_in_to_upload"), {
            fallbackVisual: "settings",
          });
          return;
        }

        setQueueState((state) =>
          recordReviewDecision(state, clientId, "upload")
        );
      }
    } catch (error) {
      logger.error("Failed to upload the screenshots", error);
      showErrorToast(t("screenshots_review_action_failed"), {
        fallbackVisual: "settings",
      });
    } finally {
      setPendingAction(null);
    }
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
  const undecidedCount = getUndecidedReviewIds(queueState).length;

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
              <InlineTextField
                key={current.clientId}
                focusId={TITLE_FOCUS_ID}
                className="screenshot-review-modal__title-field"
                label={t("screenshots_custom_title_label")}
                value={draft.customGameTitle.trim()}
                placeholder={t("screenshots_custom_game")}
                icon={<PencilSimpleIcon size={18} />}
                maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
                allowEmpty
                disabled={isUploading || isBusy}
                onSave={(customGameTitle) => {
                  updateDraft({ customGameTitle });
                  return true;
                }}
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

          <ReviewActions
            isUploading={isUploading}
            canRetry={canRetry}
            isLastItem={index >= queue.length - 1}
            isBusy={isBusy}
            pendingAction={pendingAction}
            undecidedCount={undecidedCount}
            onRetry={upload}
            onNext={() => goToNextFrom(current.clientId)}
            onDelete={() => setIsDeleteConfirmVisible(true)}
            onKeep={() => void skip()}
            onKeepAll={keepAll}
            onUpload={upload}
            onUploadAll={() => void uploadAll()}
          />
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
