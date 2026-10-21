import { useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  CopyIcon,
  EyeClosedIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  ReportIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { Tooltip } from "react-tooltip";

import { Avatar } from "../avatar/avatar";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate, useFeature, useUserDetails } from "@renderer/hooks";
import { AuthPage } from "@shared";
import type { ProfileScreenshot } from "@types";

import { ScreenshotComments } from "./screenshot-comments";
import { ScreenshotOwnerControls } from "./screenshot-owner-controls";
import { getScreenshotGameTitle } from "./screenshot-labels";
import type { ScreenshotFailure } from "./use-screenshot-actions";
import type { ScreenshotPatch } from "./use-screenshot-feed";
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
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

function ScreenshotPanelActions({
  screenshot,
  actions,
  isOwner,
  isApproved,
  onRequestDelete,
  onRequestReport,
}: Readonly<ScreenshotPanelActionsProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const tooltipId = useId();
  const isReported = actions.reportedIds.has(screenshot.id);
  const likeLabelKey = screenshot.likedByMe ? "unlike" : "like";
  const likeLabel = t(userDetails ? likeLabelKey : "sign_in_to_like");
  const copyLabel = t("copy_image");
  const reportLabel = t(isReported ? "reported" : "report_screenshot");
  const deleteLabel = t("delete_screenshot");

  const handleReportClick = () => {
    if (!userDetails) {
      void window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    onRequestReport();
  };

  return (
    <div className="screenshot-lightbox__actions">
      <button
        type="button"
        className={cn("screenshot-lightbox__action", {
          "screenshot-lightbox__action--active": screenshot.likedByMe,
        })}
        onClick={() => void actions.toggleLike(screenshot)}
        disabled={!isApproved || actions.likingIds.has(screenshot.id)}
        aria-pressed={screenshot.likedByMe}
        aria-label={likeLabel}
        data-tooltip-id={tooltipId}
        data-tooltip-content={likeLabel}
      >
        {screenshot.likedByMe ? (
          <HeartFillIcon size={16} />
        ) : (
          <HeartIcon size={16} />
        )}
        <span>{screenshot.likeCount}</span>
      </button>

      <button
        type="button"
        className="screenshot-lightbox__action screenshot-lightbox__action--icon screenshot-lightbox__copy"
        onClick={() => void actions.copyImage(screenshot)}
        disabled={!screenshot.imageUrl || actions.copyingIds.has(screenshot.id)}
        aria-label={copyLabel}
        data-tooltip-id={tooltipId}
        data-tooltip-content={copyLabel}
      >
        <CopyIcon size={16} />
      </button>

      {isOwner ? (
        <button
          type="button"
          className="screenshot-lightbox__action screenshot-lightbox__action--icon screenshot-lightbox__action--danger screenshot-lightbox__delete"
          onClick={onRequestDelete}
          disabled={actions.deletingIds.has(screenshot.id)}
          aria-label={deleteLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={deleteLabel}
        >
          <TrashIcon size={16} />
        </button>
      ) : null}

      {!isOwner && isApproved ? (
        <button
          type="button"
          className="screenshot-lightbox__action screenshot-lightbox__action--icon screenshot-lightbox__report"
          onClick={handleReportClick}
          disabled={isReported || actions.reportingIds.has(screenshot.id)}
          aria-label={reportLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={reportLabel}
        >
          <ReportIcon size={16} />
        </button>
      ) : null}

      <Tooltip
        id={tooltipId}
        place="top"
        positionStrategy="fixed"
        className="screenshot-lightbox__tooltip"
      />
    </div>
  );
}

interface ScreenshotLightboxPanelProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotActions;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onPatch: (screenshotId: string, patch: ScreenshotPatch) => void;
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
  const { isFeatureEnabled, Feature } = useFeature();
  const isOwner = userDetails?.id === screenshot.owner.id;
  const isCommentsEnabled = isFeatureEnabled(Feature.ScreenshotComments);
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

      <ScreenshotPanelActions
        screenshot={screenshot}
        actions={actions}
        isOwner={isOwner}
        isApproved={isApproved}
        onRequestDelete={onRequestDelete}
        onRequestReport={onRequestReport}
      />

      {isOwner ? (
        <ScreenshotOwnerControls
          screenshot={screenshot}
          isUpdating={actions.updatingIds.has(screenshot.id)}
          onUpdate={(update) => actions.updateScreenshot(screenshot, update)}
        />
      ) : null}

      {isCommentsEnabled ? (
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
