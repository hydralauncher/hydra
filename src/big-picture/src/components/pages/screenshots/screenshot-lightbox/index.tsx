import "./styles.scss";

import {
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  EyeIcon,
  FlagIcon,
  GameControllerIcon,
  GearSixIcon,
  HeartIcon,
  ImageIcon,
  LockSimpleIcon,
  ProhibitIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ScreenshotLikeResponse,
  ScreenshotReportValues,
  ScreenshotUpdateRequest,
} from "@types";
import {
  AuthPage,
  SCREENSHOT_REPORT_REASONS,
  buildProfileScreenshotPath,
  buildUserScreenshotLikePath,
  buildUserScreenshotReportPath,
  getScreenshotApiErrorCode,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  Backdrop,
  Button,
  HorizontalFocusGroup,
  NavigationLayer,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "../../../common";
import { FocusRegionContext, useFocusLayerId } from "../../../context";
import { ConfirmationModal } from "../../../modals";
import {
  Feature,
  useBigPictureToast,
  useFeature,
  useGamepad,
  useNavigationScreenActions,
  useUserDetails,
} from "../../../../hooks";
import { useInputModeStore, useVirtualKeyboardStore } from "../../../../stores";
import { GamepadButtonType } from "../../../../types";
import { NavigationService } from "../../../../services";
import {
  formatScreenshotDate,
  getScreenshotAltText,
  getScreenshotErrorKey,
  getScreenshotGameTitle,
  shouldBlurScreenshot,
} from "../helpers";
import { ScreenshotManageModal } from "../screenshot-manage-modal";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import { useRevealedScreenshotSpoilers } from "../use-revealed-spoilers";
import { ScreenshotCommentsPanel } from "./comments-panel";

export type ScreenshotLightboxStatus =
  | "loading"
  | "ready"
  | "private"
  | "unavailable";

export interface ScreenshotLightboxProps {
  status: ScreenshotLightboxStatus | null;
  screenshot: ProfileScreenshot | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onUpdate: (screenshotId: string, update: Partial<ProfileScreenshot>) => void;
  onRemove: (screenshotId: string) => void;
}

const SETTINGS_TOAST = { fallbackVisual: "settings" as const };
const STATUS_CLOSE_FOCUS_ID = "screenshot-lightbox-status-close";
const STATUS_REGION_ID = "screenshot-lightbox-status";

const shouldRestoreLightboxFocus = () =>
  useInputModeStore.getState().mode === "gamepad";

const LIGHTBOX_ROOT_REGION_ID = "screenshot-lightbox-root";
const navigationService = NavigationService.getInstance();

const getLightboxFocusIds = (screenshotId: string) => ({
  media: `screenshot-lightbox-media:${screenshotId}`,
  actions: `screenshot-lightbox-actions:${screenshotId}`,
  reveal: `screenshot-lightbox-reveal:${screenshotId}`,
  like: `screenshot-lightbox-like:${screenshotId}`,
  report: `screenshot-lightbox-report:${screenshotId}`,
  manage: `screenshot-lightbox-manage:${screenshotId}`,
  remove: `screenshot-lightbox-delete:${screenshotId}`,
  copy: `screenshot-lightbox-copy:${screenshotId}`,
});

function useBlockingOverlayGuard() {
  const [isCommentsOverlayOpen, setIsCommentsOverlayOpen] = useState(false);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );

  return {
    isCommentsOverlayOpen,
    setIsCommentsOverlayOpen,
    isVirtualKeyboardOpen: virtualKeyboardTarget !== null,
  };
}

interface LightboxStatusPanelProps {
  status: Exclude<ScreenshotLightboxStatus, "ready">;
  onClose: () => void;
  onLayerChange: (layerId: string | null) => void;
}

interface LightboxLayerReporterProps {
  onLayerChange: (layerId: string | null) => void;
}

function LightboxLayerReporter({
  onLayerChange,
}: Readonly<LightboxLayerReporterProps>) {
  const layerId = useFocusLayerId();

  useLayoutEffect(() => {
    onLayerChange(layerId);
    return () => onLayerChange(null);
  }, [layerId, onLayerChange]);

  return null;
}

function LightboxStatusPanel({
  status,
  onClose,
  onLayerChange,
}: Readonly<LightboxStatusPanelProps>) {
  const { t } = useTranslation("big_picture");
  const messages = {
    loading: {
      icon: <ImageIcon size={40} />,
      title: t("screenshots_loading"),
    },
    private: {
      icon: <LockSimpleIcon size={40} />,
      title: t("screenshots_error_private"),
    },
    unavailable: {
      icon: <ProhibitIcon size={40} />,
      title: t("screenshots_error_unavailable"),
    },
  } as const;
  const message = messages[status];

  return (
    <NavigationLayer
      rootRegionId={STATUS_REGION_ID}
      initialFocusId={STATUS_CLOSE_FOCUS_ID}
      restoreFocusOnUnmount={shouldRestoreLightboxFocus}
    >
      <LightboxLayerReporter onLayerChange={onLayerChange} />
      <VerticalFocusGroup regionId={STATUS_REGION_ID} asChild>
        <div
          className="screenshot-lightbox__status"
          role="alertdialog"
          aria-label={message.title}
        >
          {message.icon}
          <p>{message.title}</p>
          <Button
            variant="secondary"
            focusId={STATUS_CLOSE_FOCUS_ID}
            onClick={onClose}
          >
            {t("screenshots_close")}
          </Button>
        </div>
      </VerticalFocusGroup>
    </NavigationLayer>
  );
}

interface LightboxImageProps {
  screenshot: ProfileScreenshot;
  isBlurred: boolean;
  revealFocusId: string;
  onReveal: () => void;
}

function LightboxImage({
  screenshot,
  isBlurred,
  revealFocusId,
  onReveal,
}: Readonly<LightboxImageProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const hasImage = Boolean(
    screenshot.imageUrl && screenshot.imageUrl !== failedUrl
  );

  return (
    <div className="screenshot-lightbox__stage">
      {hasImage ? (
        <img
          className={cn("screenshot-lightbox__image", {
            "screenshot-lightbox__image--spoiler": isBlurred,
          })}
          src={screenshot.imageUrl ?? undefined}
          alt={getScreenshotAltText(screenshot, t, language)}
          draggable={false}
          onError={() => setFailedUrl(screenshot.imageUrl)}
        />
      ) : (
        <div className="screenshot-lightbox__placeholder">
          <ImageIcon size={56} />
          <span>{t("screenshots_image_unavailable")}</span>
        </div>
      )}

      {isBlurred && hasImage ? (
        <div className="screenshot-lightbox__spoiler">
          <span>{t("screenshots_spoiler_warning")}</span>
          <Button
            variant="secondary"
            focusId={revealFocusId}
            icon={<EyeIcon size={18} />}
            onClick={onReveal}
          >
            {t("screenshots_reveal_spoiler")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface LightboxSummaryProps {
  screenshot: ProfileScreenshot;
}

function LightboxSummary({ screenshot }: Readonly<LightboxSummaryProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const hasGameIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );

  return (
    <div className="screenshot-lightbox__summary">
      <div className="screenshot-lightbox__game">
        <span className="screenshot-lightbox__game-icon">
          {hasGameIcon ? (
            <img
              src={screenshot.gameIconUrl ?? undefined}
              alt=""
              draggable={false}
              onError={() => setFailedIconUrl(screenshot.gameIconUrl)}
            />
          ) : (
            <GameControllerIcon size={18} />
          )}
        </span>
        <span className="screenshot-lightbox__game-title">
          {getScreenshotGameTitle(screenshot, t)}
        </span>
        {screenshot.isCustomGame ? (
          <span className="screenshot-lightbox__tag">
            {t("screenshots_custom_game_tag")}
          </span>
        ) : null}
      </div>
      <div className="screenshot-lightbox__meta">
        <UserProfileAvatar
          image={screenshot.owner.profileImageUrl}
          alt=""
          className="screenshot-lightbox__avatar"
          fallbackClassName="screenshot-lightbox__avatar--fallback"
          width={20}
          height={20}
          iconSize={12}
        />
        <span>{screenshot.owner.displayName}</span>
        <span className="screenshot-lightbox__meta-separator" aria-hidden />
        <span>{formatScreenshotDate(screenshot.capturedAt, language)}</span>
      </div>
    </div>
  );
}

function getLikeLabelKey(likedByMe: boolean, isSignedIn: boolean) {
  if (!isSignedIn) return "screenshots_sign_in_to_like";

  return likedByMe ? "screenshots_unlike" : "screenshots_like";
}

interface LightboxActionsProps {
  screenshot: ProfileScreenshot;
  focusIds: ReturnType<typeof getLightboxFocusIds>;
  isOwner: boolean;
  isSignedIn: boolean;
  isLiking: boolean;
  isReported: boolean;
  isCopying: boolean;
  onLike: () => void;
  onCopy: () => void;
  onReport: () => void;
  onManage: () => void;
  onDelete: () => void;
}

function LightboxActions({
  screenshot,
  focusIds,
  isOwner,
  isSignedIn,
  isLiking,
  isReported,
  isCopying,
  onLike,
  onCopy,
  onReport,
  onManage,
  onDelete,
}: Readonly<LightboxActionsProps>) {
  const { t } = useTranslation("big_picture");
  const canLike =
    screenshot.moderationStatus === undefined ||
    screenshot.moderationStatus === "APPROVED";
  const likeLabel = t(getLikeLabelKey(screenshot.likedByMe, isSignedIn));

  return (
    <HorizontalFocusGroup
      regionId={focusIds.actions}
      className="screenshot-lightbox__actions"
    >
      <Button
        variant="secondary"
        size="small"
        focusId={focusIds.like}
        disabled={!canLike}
        loading={isLiking}
        className={cn({
          "screenshot-lightbox__action--pending": isLiking,
        })}
        icon={
          <HeartIcon
            size={20}
            weight={screenshot.likedByMe ? "fill" : "regular"}
          />
        }
        aria-label={likeLabel}
        title={likeLabel}
        onClick={onLike}
      >
        {String(screenshot.likeCount)}
      </Button>

      {screenshot.imageUrl ? (
        <Button
          variant="secondary"
          size="icon"
          focusId={focusIds.copy}
          loading={isCopying}
          icon={<CopyIcon size={20} />}
          aria-label={t("screenshots_copy_image")}
          title={t("screenshots_copy_image")}
          onClick={onCopy}
        >
          {null}
        </Button>
      ) : null}

      {isOwner ? (
        <>
          <Button
            variant="secondary"
            size="small"
            focusId={focusIds.manage}
            icon={<GearSixIcon size={20} />}
            onClick={onManage}
          >
            {t("screenshots_manage")}
          </Button>
          <Button
            variant="danger"
            size="icon"
            focusId={focusIds.remove}
            icon={<TrashIcon size={20} />}
            aria-label={t("screenshots_delete")}
            title={t("screenshots_delete")}
            onClick={onDelete}
          >
            {null}
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.report}
          disabled={isReported}
          icon={<FlagIcon size={20} />}
          onClick={onReport}
        >
          {t(isReported ? "screenshots_reported" : "screenshots_report")}
        </Button>
      )}
    </HorizontalFocusGroup>
  );
}

function useLightboxSocialActions({
  screenshot,
  isSignedIn,
  onUpdate,
  onRemove,
}: {
  screenshot: ProfileScreenshot | null;
  isSignedIn: boolean;
  onUpdate: ScreenshotLightboxProps["onUpdate"];
  onRemove: ScreenshotLightboxProps["onRemove"];
}) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [likingIds, setLikingIds] = useState<Set<string>>(new Set());
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [isReporting, setIsReporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const showError = useCallback(
    (error: unknown) => {
      showErrorToast(
        t(getScreenshotErrorKey(getScreenshotApiErrorCode(error))),
        SETTINGS_TOAST
      );
    },
    [showErrorToast, t]
  );

  const toggleLike = useCallback(async () => {
    if (!screenshot) return;

    if (!isSignedIn) {
      void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (likingIds.has(screenshot.id)) return;

    const previous = {
      likeCount: screenshot.likeCount,
      likedByMe: screenshot.likedByMe,
    };
    const likedByMe = !screenshot.likedByMe;
    const path = buildUserScreenshotLikePath(
      screenshot.owner.id,
      screenshot.id
    );

    setLikingIds((current) => new Set(current).add(screenshot.id));
    onUpdate(screenshot.id, {
      likedByMe,
      likeCount: Math.max(0, screenshot.likeCount + (likedByMe ? 1 : -1)),
    });

    try {
      const response = likedByMe
        ? await globalThis.window.electron.hydraApi.put<ScreenshotLikeResponse>(
            path,
            { needsAuth: true }
          )
        : await globalThis.window.electron.hydraApi.delete<ScreenshotLikeResponse>(
            path,
            { needsAuth: true }
          );

      if (response) onUpdate(screenshot.id, response);
    } catch (error) {
      onUpdate(screenshot.id, previous);
      showError(error);
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(screenshot.id);
        return next;
      });
    }
  }, [isSignedIn, likingIds, onUpdate, screenshot, showError]);

  const report = useCallback(
    async (values: ScreenshotReportValues) => {
      if (!screenshot) return false;

      setIsReporting(true);

      try {
        await globalThis.window.electron.hydraApi.post(
          buildUserScreenshotReportPath(screenshot.owner.id, screenshot.id),
          { data: values, needsAuth: true }
        );
        setReportedIds((current) => new Set(current).add(screenshot.id));
        showSuccessToast(t("screenshots_reported_toast"), SETTINGS_TOAST);
        return true;
      } catch (error) {
        const code = getScreenshotApiErrorCode(error);
        showError(error);

        if (code === "screenshots/already-reported") {
          setReportedIds((current) => new Set(current).add(screenshot.id));
          return true;
        }

        if (code === "screenshots/not-found") {
          onRemove(screenshot.id);
          return true;
        }

        return false;
      } finally {
        setIsReporting(false);
      }
    },
    [onRemove, screenshot, showError, showSuccessToast, t]
  );

  const save = useCallback(
    async (update: ScreenshotUpdateRequest) => {
      if (!screenshot) return false;

      setIsSaving(true);

      try {
        const updated =
          await globalThis.window.electron.hydraApi.patch<ProfileScreenshot>(
            buildProfileScreenshotPath(screenshot.id),
            { data: update, needsAuth: true }
          );
        onUpdate(screenshot.id, updated ?? update);
        showSuccessToast(t("screenshots_saved"), SETTINGS_TOAST);
        return true;
      } catch (error) {
        showError(error);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onUpdate, screenshot, showError, showSuccessToast, t]
  );

  const remove = useCallback(async () => {
    if (!screenshot) return false;

    setIsDeleting(true);

    try {
      await globalThis.window.electron.hydraApi.delete(
        buildProfileScreenshotPath(screenshot.id),
        { needsAuth: true }
      );
      onRemove(screenshot.id);
      showSuccessToast(t("screenshots_deleted"), SETTINGS_TOAST);
      return true;
    } catch (error) {
      logger.error("Failed to delete screenshot", error);
      showError(error);
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [onRemove, screenshot, showError, showSuccessToast, t]);

  const copyImage = useCallback(async () => {
    if (!screenshot?.imageUrl || isCopying) return;

    setIsCopying(true);

    try {
      const copied = await globalThis.window.electron.clipboard.writeImage(
        screenshot.imageUrl
      );

      if (copied) {
        showSuccessToast(t("screenshots_copied"), SETTINGS_TOAST);
      } else {
        showErrorToast(t("screenshots_copy_failed"), SETTINGS_TOAST);
      }
    } catch (error) {
      logger.error("Failed to copy screenshot", error);
      showErrorToast(t("screenshots_copy_failed"), SETTINGS_TOAST);
    } finally {
      setIsCopying(false);
    }
  }, [isCopying, screenshot, showErrorToast, showSuccessToast, t]);

  return {
    isCopying,
    copyImage,
    isLiking: Boolean(screenshot && likingIds.has(screenshot.id)),
    isReported: Boolean(screenshot && reportedIds.has(screenshot.id)),
    isReporting,
    isSaving,
    isDeleting,
    toggleLike,
    report,
    save,
    remove,
  };
}

interface LightboxShortcutsOptions {
  isOpen: boolean;
  canUseShortcuts: boolean;
  hasLocalOverlay: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  isActiveLayer: () => boolean;
}

const isTypingInField = () => {
  const activeElement = globalThis.document.activeElement;

  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  );
};

function useLightboxShortcuts({
  isOpen,
  canUseShortcuts,
  hasLocalOverlay,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  isActiveLayer,
}: LightboxShortcutsOptions) {
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const canGoPrevious = canUseShortcuts && hasPrevious;
  const canGoNext = canUseShortcuts && hasNext;

  useNavigationScreenActions(
    isOpen && !hasLocalOverlay
      ? {
          press: {
            b: () => {
              if (isActiveLayer()) onClose();
            },
          },
        }
      : {}
  );

  useEffect(() => {
    const removeLeft = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (canGoPrevious && isActiveGamepadEvent(event) && isActiveLayer())
          onPrevious();
      }
    );
    const removeRight = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (canGoNext && isActiveGamepadEvent(event) && isActiveLayer())
          onNext();
      }
    );

    return () => {
      removeLeft();
      removeRight();
    };
  }, [
    canGoNext,
    canGoPrevious,
    isActiveGamepadEvent,
    isActiveLayer,
    onButtonPressed,
    onNext,
    onPrevious,
  ]);

  useEffect(() => {
    if (!isOpen || hasLocalOverlay) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingInField() || !isActiveLayer())
        return;

      if (event.key === "Escape") onClose();
      if (event.key === "PageUp" && hasPrevious) onPrevious();
      if (event.key === "PageDown" && hasNext) onNext();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [
    hasLocalOverlay,
    hasNext,
    hasPrevious,
    isActiveLayer,
    isOpen,
    onClose,
    onNext,
    onPrevious,
  ]);
}

interface LightboxNavButtonsProps {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

function LightboxNavButtons({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: Readonly<LightboxNavButtonsProps>) {
  const { t } = useTranslation("big_picture");

  return (
    <>
      {hasPrevious ? (
        <button
          type="button"
          className="screenshot-lightbox__nav screenshot-lightbox__nav--left"
          aria-label={t("screenshots_previous")}
          onClick={onPrevious}
        >
          <CaretLeftIcon size={28} />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="screenshot-lightbox__nav screenshot-lightbox__nav--right"
          aria-label={t("screenshots_next")}
          onClick={onNext}
        >
          <CaretRightIcon size={28} />
        </button>
      ) : null}
    </>
  );
}

type LightboxSocial = ReturnType<typeof useLightboxSocialActions>;

interface LightboxDialogProps {
  screenshot: ProfileScreenshot;
  viewerId: string | null;
  isOwner: boolean;
  showComments: boolean;
  social: LightboxSocial;
  onUpdate: ScreenshotLightboxProps["onUpdate"];
  onOverlayChange: (isOpen: boolean) => void;
  onRequestReport: () => void;
  onRequestManage: () => void;
  onRequestDelete: () => void;
  onLayerChange: (layerId: string | null) => void;
  isActiveLayer: () => boolean;
}

function LightboxDialog({
  screenshot,
  viewerId,
  isOwner,
  showComments,
  social,
  onUpdate,
  onOverlayChange,
  onRequestReport,
  onRequestManage,
  onRequestDelete,
  onLayerChange,
  isActiveLayer,
}: Readonly<LightboxDialogProps>) {
  const { t } = useTranslation("big_picture");
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const revealSpoiler = useRevealedScreenshotSpoilers((state) => state.reveal);
  const focusIds = getLightboxFocusIds(screenshot.id);
  const isBlurred =
    shouldBlurScreenshot(screenshot, revealedIds) &&
    Boolean(screenshot.imageUrl);

  const handleCommentCountChange = useCallback(
    (screenshotId: string, commentCount: number) => {
      onUpdate(screenshotId, { commentCount });
    },
    [onUpdate]
  );

  const commentsLeftTarget = useMemo(
    () => ({ type: "item" as const, itemId: focusIds.like }),
    [focusIds.like]
  );
  const entryFocusId = isBlurred ? focusIds.reveal : focusIds.like;
  const [initialFocusId] = useState(entryFocusId);
  const lastEntryFocusIdRef = useRef(entryFocusId);

  useEffect(() => {
    if (lastEntryFocusIdRef.current === entryFocusId) return;
    lastEntryFocusIdRef.current = entryFocusId;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      if (isActiveLayer()) navigationService.setFocus(entryFocusId);
    });

    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [entryFocusId, isActiveLayer]);

  return (
    <NavigationLayer
      rootRegionId={LIGHTBOX_ROOT_REGION_ID}
      initialFocusId={initialFocusId}
      restoreFocusOnUnmount={shouldRestoreLightboxFocus}
    >
      <LightboxLayerReporter onLayerChange={onLayerChange} />
      <HorizontalFocusGroup regionId={LIGHTBOX_ROOT_REGION_ID} asChild>
        <dialog
          open
          className={cn("screenshot-lightbox", {
            "screenshot-lightbox--with-comments": showComments,
          })}
          aria-modal="true"
          aria-label={getScreenshotGameTitle(screenshot, t)}
        >
          <VerticalFocusGroup regionId={focusIds.media} asChild>
            <section className="screenshot-lightbox__media">
              <LightboxImage
                screenshot={screenshot}
                isBlurred={isBlurred}
                revealFocusId={focusIds.reveal}
                onReveal={() => revealSpoiler(screenshot.id)}
              />
              <div className="screenshot-lightbox__info">
                <LightboxSummary screenshot={screenshot} />
                <LightboxActions
                  screenshot={screenshot}
                  focusIds={focusIds}
                  isOwner={isOwner}
                  isSignedIn={viewerId !== null}
                  isLiking={social.isLiking}
                  isReported={social.isReported}
                  isCopying={social.isCopying}
                  onLike={() => void social.toggleLike()}
                  onCopy={() => void social.copyImage()}
                  onReport={onRequestReport}
                  onManage={onRequestManage}
                  onDelete={onRequestDelete}
                />
              </div>
            </section>
          </VerticalFocusGroup>

          {showComments ? (
            <ScreenshotCommentsPanel
              key={screenshot.id}
              screenshot={screenshot}
              viewerId={viewerId}
              isOwner={isOwner}
              leftTarget={commentsLeftTarget}
              onCommentCountChange={handleCommentCountChange}
              onOverlayChange={onOverlayChange}
            />
          ) : null}
        </dialog>
      </HorizontalFocusGroup>
    </NavigationLayer>
  );
}

type LightboxModal = "manage" | "report" | "delete" | null;

interface LightboxModalsProps {
  screenshot: ProfileScreenshot;
  openModal: LightboxModal;
  social: LightboxSocial;
  onCloseModal: () => void;
  onDeleted: () => void;
}

function LightboxModals({
  screenshot,
  openModal,
  social,
  onCloseModal,
  onDeleted,
}: Readonly<LightboxModalsProps>) {
  const { t } = useTranslation("big_picture");

  return (
    <>
      <ScreenshotManageModal
        visible={openModal === "manage"}
        screenshot={screenshot}
        isSaving={social.isSaving}
        onClose={onCloseModal}
        onSave={social.save}
      />
      <ScreenshotReportModal
        visible={openModal === "report"}
        title={t("screenshots_report_title")}
        reasons={SCREENSHOT_REPORT_REASONS}
        isSubmitting={social.isReporting}
        onClose={onCloseModal}
        onSubmit={social.report}
      />
      <ConfirmationModal
        visible={openModal === "delete"}
        backdropClassName="screenshot-lightbox__confirmation-backdrop"
        title={t("screenshots_delete_title")}
        description={t("screenshots_delete_description")}
        confirmLabel={t("screenshots_delete")}
        cancelLabel={t("screenshots_cancel")}
        danger
        loading={social.isDeleting}
        onClose={onCloseModal}
        onConfirm={async () => {
          if (await social.remove()) onDeleted();
        }}
      />
    </>
  );
}

export function ScreenshotLightbox({
  status,
  screenshot,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  onUpdate,
  onRemove,
}: Readonly<ScreenshotLightboxProps>) {
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled } = useFeature();
  const [openModal, setOpenModal] = useState<LightboxModal>(null);
  const {
    isCommentsOverlayOpen,
    setIsCommentsOverlayOpen,
    isVirtualKeyboardOpen,
  } = useBlockingOverlayGuard();
  const isOpen = status !== null;
  const readyScreenshot = status === "ready" ? screenshot : null;
  const viewerId = userDetails?.id ?? null;
  const isOwner = viewerId !== null && screenshot?.owner.id === viewerId;
  const social = useLightboxSocialActions({
    screenshot,
    isSignedIn: viewerId !== null,
    onUpdate,
    onRemove,
  });
  const hasLocalOverlay =
    openModal !== null || isCommentsOverlayOpen || isVirtualKeyboardOpen;
  const layerIdRef = useRef<string | null>(null);
  const handleLayerChange = useCallback((layerId: string | null) => {
    layerIdRef.current = layerId;
  }, []);
  const isActiveLayer = useCallback(
    () =>
      layerIdRef.current !== null &&
      navigationService.getActiveLayerId() === layerIdRef.current,
    []
  );

  useEffect(() => {
    setOpenModal(null);
  }, [screenshot?.id, status]);

  useLightboxShortcuts({
    isOpen,
    canUseShortcuts: readyScreenshot !== null && !hasLocalOverlay,
    hasLocalOverlay,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
    onClose,
    isActiveLayer,
  });

  const requestReport = () => {
    if (viewerId) {
      setOpenModal("report");
      return;
    }

    void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
  };

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  if (!isOpen) return null;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <Backdrop className="screenshot-lightbox__backdrop">
        <div
          className="screenshot-lightbox__overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !hasLocalOverlay)
              onClose();
          }}
        >
          {readyScreenshot ? (
            <>
              <LightboxNavButtons
                hasPrevious={hasPrevious}
                hasNext={hasNext}
                onPrevious={onPrevious}
                onNext={onNext}
              />
              <LightboxDialog
                screenshot={readyScreenshot}
                viewerId={viewerId}
                isOwner={isOwner}
                showComments={isFeatureEnabled(Feature.ScreenshotComments)}
                social={social}
                onUpdate={onUpdate}
                onOverlayChange={setIsCommentsOverlayOpen}
                onRequestReport={requestReport}
                onRequestManage={() => setOpenModal("manage")}
                onRequestDelete={() => setOpenModal("delete")}
                onLayerChange={handleLayerChange}
                isActiveLayer={isActiveLayer}
              />
              <LightboxModals
                screenshot={readyScreenshot}
                openModal={openModal}
                social={social}
                onCloseModal={() => setOpenModal(null)}
                onDeleted={() => {
                  setOpenModal(null);
                  onClose();
                }}
              />
            </>
          ) : null}
          {status === "ready" ? null : (
            <LightboxStatusPanel
              status={status}
              onClose={onClose}
              onLayerChange={handleLayerChange}
            />
          )}
        </div>
      </Backdrop>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
