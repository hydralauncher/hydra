import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  BlockedIcon,
  ClockIcon,
  CopyIcon,
  EyeClosedIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  ReportIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate, useUserDetails } from "@renderer/hooks";
import { AuthPage, getScreenshotModerationReasonKey } from "@shared";
import type { ProfileScreenshot } from "@types";

import { ScreenshotComments } from "./screenshot-comments";
import { ScreenshotOwnerControls } from "./screenshot-owner-controls";
import { getScreenshotGameTitle } from "./screenshot-labels";
import type { ScreenshotFailure } from "./use-screenshot-actions";
import type { ScreenshotCollection } from "./use-screenshot-collection";

type ScreenshotActions = ScreenshotCollection["actions"];

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

interface ScreenshotPanelHeaderProps {
  screenshot: ProfileScreenshot;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}

function ScreenshotPanelHeader({
  screenshot,
  closeButtonRef,
  onClose,
}: Readonly<ScreenshotPanelHeaderProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime } = useDate();

  return (
    <header className="screenshot-lightbox__header">
      <Link
        className="screenshot-lightbox__author"
        to={`/profile/${encodeURIComponent(screenshot.owner.id)}`}
        onClick={onClose}
      >
        <Avatar size={36} src={screenshot.owner.profileImageUrl} alt="" />
        <span className="screenshot-lightbox__author-copy">
          <strong>{screenshot.owner.displayName}</strong>
          <time dateTime={new Date(screenshot.capturedAt).toISOString()}>
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
        onClick={onClose}
        aria-label={t("close")}
        title={t("close")}
      >
        <XIcon size={20} />
      </button>
    </header>
  );
}

interface ScreenshotPanelActionsProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotActions;
  isOwner: boolean;
  isApproved: boolean;
  onRequestReport: () => void;
}

function ScreenshotPanelActions({
  screenshot,
  actions,
  isOwner,
  isApproved,
  onRequestReport,
}: Readonly<ScreenshotPanelActionsProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const isReported = actions.reportedIds.has(screenshot.id);
  const likeLabelKey = screenshot.likedByMe ? "unlike" : "like";
  const likeLabel = t(userDetails ? likeLabelKey : "sign_in_to_like");

  const handleReportClick = () => {
    if (!userDetails) {
      void window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    onRequestReport();
  };

  return (
    <div className="screenshot-lightbox__actions">
      {isApproved ? (
        <button
          type="button"
          className={cn("screenshot-lightbox__action", {
            "screenshot-lightbox__action--active": screenshot.likedByMe,
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
        disabled={!screenshot.imageUrl || actions.copyingIds.has(screenshot.id)}
      >
        <CopyIcon size={16} />
        <span>{t("copy_image")}</span>
      </button>

      {!isOwner && isApproved ? (
        <button
          type="button"
          className="screenshot-lightbox__action"
          onClick={handleReportClick}
          disabled={isReported || actions.reportingIds.has(screenshot.id)}
        >
          <ReportIcon size={16} />
          <span>{t(isReported ? "reported" : "report")}</span>
        </button>
      ) : null}
    </div>
  );
}

interface ScreenshotLightboxPanelProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotActions;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onPatch: (screenshotId: string, patch: Partial<ProfileScreenshot>) => void;
  onFailure: (screenshotId: string, failure: ScreenshotFailure) => void;
  onClose: () => void;
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

export function ScreenshotLightboxPanel({
  screenshot,
  actions,
  closeButtonRef,
  onPatch,
  onFailure,
  onClose,
  onRequestDelete,
  onRequestReport,
}: Readonly<ScreenshotLightboxPanelProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const isOwner = userDetails?.id === screenshot.owner.id;
  const isApproved =
    !screenshot.moderationStatus || screenshot.moderationStatus === "APPROVED";

  return (
    <aside className="screenshot-lightbox__panel">
      <ScreenshotPanelHeader
        screenshot={screenshot}
        closeButtonRef={closeButtonRef}
        onClose={onClose}
      />

      <div className="screenshot-lightbox__game-row">
        <ScreenshotGameTag screenshot={screenshot} onNavigateAway={onClose} />
        {screenshot.isSpoiler ? (
          <span className="screenshot-lightbox__tag screenshot-lightbox__tag--spoiler">
            <EyeClosedIcon size={12} />
            {t("spoiler")}
          </span>
        ) : null}
      </div>

      {isOwner ? <ScreenshotModerationNotice screenshot={screenshot} /> : null}

      <ScreenshotPanelActions
        screenshot={screenshot}
        actions={actions}
        isOwner={isOwner}
        isApproved={isApproved}
        onRequestReport={onRequestReport}
      />

      {isOwner ? (
        <ScreenshotOwnerControls
          screenshot={screenshot}
          isUpdating={actions.updatingIds.has(screenshot.id)}
          isDeleting={actions.deletingIds.has(screenshot.id)}
          onUpdate={(update) => actions.updateScreenshot(screenshot, update)}
          onRequestDelete={onRequestDelete}
        />
      ) : null}

      {isApproved ? (
        <ScreenshotComments
          key={screenshot.id}
          screenshot={screenshot}
          onPatch={onPatch}
          onFailure={onFailure}
          onNavigateAway={onClose}
        />
      ) : null}
    </aside>
  );
}
