import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  BlockedIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  EyeClosedIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  LockIcon,
  ReportIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import { Button } from "../button/button";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { AuthPage, getScreenshotModerationReasonKey } from "@shared";
import { useDate, useUserDetails } from "@renderer/hooks";
import type { ProfileScreenshot } from "@types";

import { ScreenshotComments } from "./screenshot-comments";
import { ScreenshotOwnerControls } from "./screenshot-owner-controls";
import { ScreenshotReportModal } from "./screenshot-report-modal";
import { getScreenshotGameTitle } from "./screenshot-labels";
import type { ScreenshotCollection } from "./use-screenshot-collection";
import { useScreenshotSpoiler } from "./use-screenshot-spoiler";

import "./screenshot-lightbox.scss";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const isTopMostDialog = (dialog: HTMLElement | null) => {
  const dialogs = document.querySelectorAll("[role=dialog]");
  return dialog !== null && dialogs[dialogs.length - 1] === dialog;
};

interface ScreenshotMediaProps {
  screenshot: ProfileScreenshot;
  onImageError: (screenshot: ProfileScreenshot) => void;
}

function ScreenshotMedia({
  screenshot,
  onImageError,
}: Readonly<ScreenshotMediaProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const hasImage = Boolean(
    screenshot.imageUrl && screenshot.imageUrl !== failedImageUrl
  );
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  if (!hasImage) {
    return (
      <div
        className="screenshot-lightbox__placeholder"
        role="img"
        aria-label={altText}
      >
        <ImageIcon size={48} />
        <span>{t("image_unavailable")}</span>
      </div>
    );
  }

  return (
    <>
      <img
        key={screenshot.imageUrl}
        className={cn("screenshot-lightbox__image", {
          "screenshot-lightbox__image--spoiler": isSpoilerHidden,
        })}
        src={screenshot.imageUrl ?? undefined}
        alt={altText}
        onError={() => {
          setFailedImageUrl(screenshot.imageUrl);
          onImageError(screenshot);
        }}
      />
      {isSpoilerHidden ? (
        <button
          type="button"
          className="screenshot-lightbox__spoiler"
          onClick={reveal}
        >
          <EyeClosedIcon size={24} />
          <span>{t("spoiler_reveal")}</span>
        </button>
      ) : null}
    </>
  );
}

function ScreenshotGameTag({
  screenshot,
  onNavigateAway,
}: Readonly<{ screenshot: ProfileScreenshot; onNavigateAway: () => void }>) {
  const { t } = useTranslation("screenshots");
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const title = getScreenshotGameTitle(screenshot, t);
  const hasIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );
  const icon = (
    <span className="screenshot-lightbox__game-icon">
      {hasIcon ? (
        <img
          src={screenshot.gameIconUrl ?? undefined}
          alt=""
          onError={() => setFailedIconUrl(screenshot.gameIconUrl)}
        />
      ) : (
        <ImageIcon size={14} />
      )}
    </span>
  );

  if (screenshot.isCustomGame || !screenshot.objectId) {
    return (
      <span className="screenshot-lightbox__game screenshot-lightbox__game--custom">
        {icon}
        <span className="screenshot-lightbox__game-name" title={title}>
          {title}
        </span>
        <span className="screenshot-lightbox__tag">{t("custom_game_tag")}</span>
      </span>
    );
  }

  return (
    <Link
      className="screenshot-lightbox__game screenshot-lightbox__game--link"
      to={buildGameDetailsPath({
        shop: screenshot.shop,
        objectId: screenshot.objectId,
        title,
      })}
      onClick={onNavigateAway}
    >
      {icon}
      <span className="screenshot-lightbox__game-name" title={title}>
        {title}
      </span>
    </Link>
  );
}

function ScreenshotModerationNotice({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");
  const { t: tModeration } = useTranslation("screenshots_moderation");

  if (screenshot.moderationStatus === "PENDING") {
    return (
      <div className="screenshot-lightbox__notice screenshot-lightbox__notice--pending">
        <ClockIcon size={16} />
        <div>
          <strong>{t("status_pending")}</strong>
          <span>{t("status_pending_description")}</span>
        </div>
      </div>
    );
  }

  if (screenshot.moderationStatus === "BLOCKED") {
    return (
      <div className="screenshot-lightbox__notice screenshot-lightbox__notice--blocked">
        <BlockedIcon size={16} />
        <div>
          <strong>{t("status_blocked")}</strong>
          <span>
            {t("status_blocked_description", {
              reason: tModeration(
                getScreenshotModerationReasonKey(screenshot.moderationReason)
              ),
            })}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

interface ScreenshotLightboxStateProps {
  status: "loading" | "private" | "unavailable";
  onClose: () => void;
}

function ScreenshotLightboxState({
  status,
  onClose,
}: Readonly<ScreenshotLightboxStateProps>) {
  const { t } = useTranslation("screenshots");
  const content = {
    loading: { icon: <ImageIcon size={32} />, text: t("loading_screenshot") },
    private: { icon: <LockIcon size={32} />, text: t("screenshot_private") },
    unavailable: {
      icon: <AlertIcon size={32} />,
      text: t("screenshot_unavailable"),
    },
  }[status];

  return (
    <div className="screenshot-lightbox__state" role="status">
      <span className="screenshot-lightbox__state-icon">{content.icon}</span>
      <p>{content.text}</p>
      {status === "loading" ? null : (
        <Button theme="outline" onClick={onClose}>
          {t("close")}
        </Button>
      )}
    </div>
  );
}

interface ScreenshotLightboxProps {
  collection: ScreenshotCollection;
}

export function ScreenshotLightbox({
  collection,
}: Readonly<ScreenshotLightboxProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime } = useDate();
  const { userDetails } = useUserDetails();
  const { feed, actions, onPatch, lightbox } = collection;
  const { status, screenshot, index, open, close, refreshScreenshot } =
    lightbox;
  const items = feed.items;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const isOpen = status !== "closed";
  const isOwner = Boolean(
    screenshot && userDetails && screenshot.owner.id === userDetails.id
  );
  const isApproved =
    !screenshot?.moderationStatus || screenshot.moderationStatus === "APPROVED";
  const previousItem = index > 0 ? items[index - 1] : null;
  const nextItem =
    index >= 0 && index < items.length - 1 ? items[index + 1] : null;
  const isBlockingModalVisible =
    isDeleteConfirmationVisible || isReportModalVisible;
  const screenshotId = screenshot?.id ?? null;

  const handleClose = useCallback(() => {
    setIsDeleteConfirmationVisible(false);
    setIsReportModalVisible(false);
    close();
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
  }, [isOpen, screenshotId, status]);

  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (!dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialogRef.current.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!isOpen || isBlockingModalVisible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopMostDialog(dialogRef.current)) {
        return;
      }

      if (event.key === "Escape") {
        handleClose();
        return;
      }

      if (event.key === "Tab") {
        trapFocus(event);
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "ArrowLeft" && previousItem) {
        open(previousItem);
      } else if (event.key === "ArrowRight" && nextItem) {
        open(nextItem);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleClose,
    isBlockingModalVisible,
    isOpen,
    nextItem,
    open,
    previousItem,
    trapFocus,
  ]);

  if (!isOpen) return null;

  const isReady = status === "ready" && screenshot;
  const isReported = Boolean(
    screenshot && actions.reportedIds.has(screenshot.id)
  );
  const handleReportClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    setIsReportModalVisible(true);
  };
  const getLikeLabel = () => {
    if (!userDetails) return t("sign_in_to_like");
    return t(screenshot?.likedByMe ? "unlike" : "like");
  };
  const likeLabel = getLikeLabel();

  return createPortal(
    <>
      <div className="screenshot-lightbox__overlay">
        <button
          type="button"
          className="screenshot-lightbox__backdrop"
          onClick={handleClose}
          aria-label={t("close")}
          tabIndex={-1}
        />

        <div
          ref={dialogRef}
          className={cn("screenshot-lightbox", {
            "screenshot-lightbox--state": !isReady,
          })}
          role="dialog"
          aria-modal="true"
          aria-label={
            isReady ? getScreenshotGameTitle(screenshot, t) : t("screenshot")
          }
        >
          {isReady ? (
            <>
              <div className="screenshot-lightbox__media">
                <ScreenshotMedia
                  key={screenshot.id}
                  screenshot={screenshot}
                  onImageError={(item) => void refreshScreenshot(item)}
                />

                {previousItem ? (
                  <button
                    type="button"
                    className="screenshot-lightbox__nav screenshot-lightbox__nav--previous"
                    onClick={() => open(previousItem)}
                    aria-label={t("previous_screenshot")}
                  >
                    <ChevronLeftIcon size={24} />
                  </button>
                ) : null}

                {nextItem ? (
                  <button
                    type="button"
                    className="screenshot-lightbox__nav screenshot-lightbox__nav--next"
                    onClick={() => open(nextItem)}
                    aria-label={t("next_screenshot")}
                  >
                    <ChevronRightIcon size={24} />
                  </button>
                ) : null}
              </div>

              <aside className="screenshot-lightbox__panel">
                <header className="screenshot-lightbox__header">
                  <Link
                    className="screenshot-lightbox__author"
                    to={`/profile/${encodeURIComponent(screenshot.owner.id)}`}
                    onClick={handleClose}
                  >
                    <Avatar
                      size={36}
                      src={screenshot.owner.profileImageUrl}
                      alt=""
                    />
                    <span className="screenshot-lightbox__author-copy">
                      <strong>{screenshot.owner.displayName}</strong>
                      <time
                        dateTime={new Date(screenshot.capturedAt).toISOString()}
                      >
                        {t("captured_on", {
                          date: formatDateTime(screenshot.capturedAt),
                        })}
                      </time>
                    </span>
                  </Link>

                  <button
                    ref={closeButtonRef}
                    type="button"
                    className="screenshot-lightbox__close"
                    onClick={handleClose}
                    aria-label={t("close")}
                    title={t("close")}
                  >
                    <XIcon size={20} />
                  </button>
                </header>

                <div className="screenshot-lightbox__game-row">
                  <ScreenshotGameTag
                    screenshot={screenshot}
                    onNavigateAway={handleClose}
                  />
                  {screenshot.isSpoiler ? (
                    <span className="screenshot-lightbox__tag screenshot-lightbox__tag--spoiler">
                      <EyeClosedIcon size={12} />
                      {t("spoiler")}
                    </span>
                  ) : null}
                </div>

                {isOwner ? (
                  <ScreenshotModerationNotice screenshot={screenshot} />
                ) : null}

                <div className="screenshot-lightbox__actions">
                  {isApproved ? (
                    <button
                      type="button"
                      className={cn("screenshot-lightbox__action", {
                        "screenshot-lightbox__action--active":
                          screenshot.likedByMe,
                      })}
                      onClick={() => void actions.toggleLike(screenshot)}
                      disabled={actions.likingIds.has(screenshot.id)}
                      aria-pressed={screenshot.likedByMe}
                      aria-label={likeLabel}
                      title={likeLabel}
                    >
                      {screenshot.likedByMe ? (
                        <HeartFillIcon size={16} />
                      ) : (
                        <HeartIcon size={16} />
                      )}
                      <span>{screenshot.likeCount}</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="screenshot-lightbox__action"
                    onClick={() => void actions.copyImage(screenshot)}
                    disabled={
                      !screenshot.imageUrl ||
                      actions.copyingIds.has(screenshot.id)
                    }
                  >
                    <CopyIcon size={16} />
                    <span>{t("copy_image")}</span>
                  </button>

                  {!isOwner && isApproved ? (
                    <button
                      type="button"
                      className="screenshot-lightbox__action"
                      onClick={handleReportClick}
                      disabled={
                        isReported || actions.reportingIds.has(screenshot.id)
                      }
                    >
                      <ReportIcon size={16} />
                      <span>{t(isReported ? "reported" : "report")}</span>
                    </button>
                  ) : null}
                </div>

                {isOwner ? (
                  <ScreenshotOwnerControls
                    screenshot={screenshot}
                    isUpdating={actions.updatingIds.has(screenshot.id)}
                    isDeleting={actions.deletingIds.has(screenshot.id)}
                    onUpdate={(update) =>
                      actions.updateScreenshot(screenshot, update)
                    }
                    onRequestDelete={() => setIsDeleteConfirmationVisible(true)}
                  />
                ) : null}

                {isApproved ? (
                  <ScreenshotComments
                    key={screenshot.id}
                    screenshot={screenshot}
                    onPatch={onPatch}
                    onFailure={lightbox.markFailure}
                    onNavigateAway={handleClose}
                  />
                ) : null}
              </aside>
            </>
          ) : (
            <>
              <button
                ref={closeButtonRef}
                type="button"
                className="screenshot-lightbox__close screenshot-lightbox__close--floating"
                onClick={handleClose}
                aria-label={t("close")}
                title={t("close")}
              >
                <XIcon size={20} />
              </button>
              <ScreenshotLightboxState
                status={status === "ready" ? "loading" : status}
                onClose={handleClose}
              />
            </>
          )}
        </div>
      </div>

      {screenshot ? (
        <>
          <ConfirmationModal
            visible={isDeleteConfirmationVisible}
            title={t("delete_screenshot_title")}
            descriptionText={t("delete_screenshot_description")}
            confirmButtonLabel={t("delete")}
            cancelButtonLabel={t("cancel")}
            confirmButtonTheme="danger"
            buttonsIsDisabled={actions.deletingIds.has(screenshot.id)}
            onConfirm={() => {
              void actions.deleteScreenshot(screenshot).then((wasDeleted) => {
                if (wasDeleted) handleClose();
              });
            }}
            onClose={() => setIsDeleteConfirmationVisible(false)}
          />

          <ScreenshotReportModal
            visible={isReportModalVisible}
            isSubmitting={actions.reportingIds.has(screenshot.id)}
            onClose={() => setIsReportModalVisible(false)}
            onSubmit={(values) => actions.reportScreenshot(screenshot, values)}
          />
        </>
      ) : null}
    </>,
    document.body
  );
}
