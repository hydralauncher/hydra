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
  isScreenshotUploadRetryable,
  resolveScreenshotPreferences,
} from "@shared";
import { logger } from "@renderer/logger";

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
import { getLocalScreenshotStatusDetail } from "../pages/screenshots";
import {
  useBigPictureToast,
  useNavigation,
  useUserPreferences,
} from "../../hooks";

const REGION_ID = "screenshot-review-modal";
const ACTIONS_REGION_ID = "screenshot-review-modal-actions";
const TITLE_FOCUS_ID = "screenshot-review-title";
const SPOILER_FOCUS_ID = "screenshot-review-spoiler";
const VISIBILITY_FOCUS_ID = "screenshot-review-visibility";
const UPLOAD_FOCUS_ID = "screenshot-review-upload";
const SKIP_FOCUS_ID = "screenshot-review-skip";
const DELETE_FOCUS_ID = "screenshot-review-delete";
const NEXT_FOCUS_ID = "screenshot-review-next";
const RETRY_FOCUS_ID = "screenshot-review-retry";

type ReviewDecision = "upload" | "skip" | "delete";

interface ReviewDraft {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string;
}

interface ReviewQueueItem {
  clientId: string;
  shop: ScreenshotReviewRequest["shop"];
  gameTitle: string;
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

function useLocalScreenshots(isActive: boolean) {
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);

  useEffect(() => {
    if (!IS_DESKTOP || !isActive) return;

    let isCurrent = true;

    globalThis.window.electron
      .getLocalScreenshots()
      .then((items) => {
        if (isCurrent) setScreenshots(items);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots", error);
      });

    const unsubscribeChange =
      globalThis.window.electron.onLocalScreenshotsChange((items) => {
        setScreenshots(items);
      });
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
      isCurrent = false;
      unsubscribeChange();
      unsubscribeProgress();
    };
  }, [isActive]);

  return screenshots;
}

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
  isLast: boolean;
  onRetry: () => void;
  onNext: () => void;
}

function UploadStatus({
  screenshot,
  isLast,
  onRetry,
  onNext,
}: Readonly<UploadStatusProps>) {
  const { t } = useTranslation("big_picture");
  const progress = Math.round((screenshot?.uploadProgress ?? 0) * 100);
  const isFailed = screenshot?.state === "failed";
  const isDone = screenshot?.state === "uploaded";
  const canRetry =
    isFailed && isScreenshotUploadRetryable(screenshot?.lastError);
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
        <div
          className="screenshot-review-modal__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      <HorizontalFocusGroup
        regionId={ACTIONS_REGION_ID}
        className="screenshot-review-modal__actions"
      >
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
          {t(isLast ? "screenshots_review_done" : "screenshots_review_next")}
        </Button>
      </HorizontalFocusGroup>
    </div>
  );
}

export function ScreenshotReviewModal() {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const { showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>(
    {}
  );
  const [pendingAction, setPendingAction] = useState<ReviewDecision | null>(
    null
  );
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const visible = queue.length > 0;
  const screenshots = useLocalScreenshots(visible);
  const defaultVisibility =
    resolveScreenshotPreferences(userPreferences).defaultVisibility;
  const defaultVisibilityRef = useRef(defaultVisibility);
  defaultVisibilityRef.current = defaultVisibility;

  useEffect(() => {
    if (!IS_DESKTOP) return;

    return globalThis.window.electron.onScreenshotReviewRequested((request) => {
      setQueue((current) => {
        const knownIds = new Set(current.map((item) => item.clientId));
        const nextItems = request.clientIds
          .filter((clientId) => !knownIds.has(clientId))
          .map((clientId) => ({
            clientId,
            shop: request.shop,
            gameTitle: request.gameTitle,
          }));

        return [...current, ...nextItems];
      });
    });
  }, []);

  const current = queue[index];
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
  };

  const updateDraft = (update: Partial<ReviewDraft>) => {
    if (!current) return;
    setDrafts((existing) => ({
      ...existing,
      [current.clientId]: { ...draft, ...update },
    }));
  };

  const reset = useCallback(() => {
    setQueue([]);
    setIndex(0);
    setDrafts({});
    setDecisions({});
    setPendingAction(null);
    setIsDeleteConfirmVisible(false);
  }, []);

  const goToNext = useCallback(() => {
    if (index >= queue.length - 1) {
      reset();
      return;
    }

    setIndex(index + 1);
  }, [index, queue.length, reset]);

  useEffect(() => {
    if (!visible) return;

    const focusId = decision === "upload" ? NEXT_FOCUS_ID : UPLOAD_FOCUS_ID;
    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(focusId);
      globalThis.document
        .getElementById(focusId)
        ?.scrollIntoView({ block: "nearest" });
    });

    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [decision, index, setFocus, visible]);

  useEffect(() => {
    if (!visible || !current || currentScreenshot || screenshots.length === 0)
      return;

    goToNext();
  }, [current, currentScreenshot, goToNext, screenshots.length, visible]);

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
      setDecisions((existing) => ({
        ...existing,
        [current.clientId]: action,
      }));
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

    void runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(current.clientId, {
        isSpoiler: draft.isSpoiler,
        visibility: draft.visibility,
        customGameTitle:
          isCustomGame && customGameTitle ? customGameTitle : null,
      })
    );
  };

  const skip = async () => {
    if (!current) return;

    const done = await runAction("skip", () =>
      globalThis.window.electron.skipLocalScreenshot(current.clientId)
    );
    if (done) goToNext();
  };

  const remove = async () => {
    if (!current) return;

    const done = await runAction("delete", () =>
      globalThis.window.electron.deleteLocalScreenshot(current.clientId)
    );
    setIsDeleteConfirmVisible(false);
    if (done) goToNext();
  };

  const close = () => {
    const undecided = queue
      .slice(index)
      .filter((item) => !decisions[item.clientId]);

    for (const item of undecided) {
      void globalThis.window.electron
        .skipLocalScreenshot(item.clientId)
        .catch((error: unknown) => {
          logger.error("Failed to keep the screenshot locally", error);
        });
    }

    reset();
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
            <UploadStatus
              screenshot={currentScreenshot}
              isLast={index >= queue.length - 1}
              onRetry={upload}
              onNext={goToNext}
            />
          ) : (
            <>
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

              <HorizontalFocusGroup
                regionId={ACTIONS_REGION_ID}
                className="screenshot-review-modal__actions"
              >
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
              </HorizontalFocusGroup>
            </>
          )}
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
