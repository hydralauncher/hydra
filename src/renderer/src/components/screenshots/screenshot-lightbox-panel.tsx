import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CopyIcon,
  GearIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  ReportIcon,
  TrashIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { Tooltip } from "react-tooltip";

import { Avatar } from "../avatar/avatar";
import { InlineEditField } from "../inline-edit-field/inline-edit-field";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate, useFeature, useUserDetails } from "@renderer/hooks";
import {
  AuthPage,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  buildScreenshotSettingsUpdate,
  readScreenshotSettings,
  sanitizeScreenshotDescriptionInput,
} from "@shared";
import type { ProfileScreenshot } from "@types";

import { ScreenshotComments } from "./screenshot-comments";
import {
  getScreenshotGameTitle,
  isScreenshotApproved,
} from "./screenshot-labels";
import type { ScreenshotFailure } from "./use-screenshot-actions";
import type { ScreenshotPatch } from "@shared";
import type { ScreenshotCollection } from "./use-screenshot-collection";
import { useSensitiveScreenshot } from "./use-sensitive-screenshot";

import "./screenshot-lightbox-panel.scss";

type ScreenshotActions = ScreenshotCollection["actions"];

function ScreenshotGameIcon({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const hasIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );

  return (
    <span className="screenshot-lightbox__game-icon">
      {hasIcon ? (
        <img
          src={screenshot.gameIconUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFailedIconUrl(screenshot.gameIconUrl)}
        />
      ) : (
        <ImageIcon size={12} />
      )}
    </span>
  );
}

function ScreenshotGameLink({
  screenshot,
  onNavigateAway,
}: Readonly<{ screenshot: ProfileScreenshot; onNavigateAway: () => void }>) {
  const { t } = useTranslation("screenshots");
  const title = getScreenshotGameTitle(screenshot, t);

  if (screenshot.isCustomGame || !screenshot.objectId) {
    return (
      <span className="screenshot-lightbox__game">
        <ScreenshotGameIcon screenshot={screenshot} />
        {title}
        <span className="screenshot-lightbox__tag">{t("custom_game_tag")}</span>
      </span>
    );
  }

  return (
    <Link
      className="screenshot-lightbox__game screenshot-lightbox__byline-link"
      to={buildGameDetailsPath({
        shop: screenshot.shop,
        objectId: screenshot.objectId,
        title,
      })}
      onClick={onNavigateAway}
    >
      <ScreenshotGameIcon screenshot={screenshot} />
      {title}
    </Link>
  );
}

interface ScreenshotPanelInfoProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotActions;
  isOwner: boolean;
  onClose: () => void;
}

function ScreenshotPanelInfo({
  screenshot,
  actions,
  isOwner,
  onClose,
}: Readonly<ScreenshotPanelInfoProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime } = useDate();
  const hasDescription = Boolean(screenshot.description);

  const saveDescription = (description: string) => {
    const update = buildScreenshotSettingsUpdate(screenshot, {
      ...readScreenshotSettings(screenshot),
      description,
    });
    if (Object.keys(update).length === 0) return true;
    return actions.updateScreenshot(screenshot, update);
  };

  return (
    <header className="screenshot-lightbox__info">
      {isOwner ? (
        <InlineEditField
          key={`${screenshot.id}:${hasDescription}`}
          className={cn({
            "screenshot-lightbox__description screenshot-lightbox__description-field":
              hasDescription,
          })}
          label={t(hasDescription ? "edit_description" : "add_description")}
          placeholder={t("add_description")}
          initialValue={screenshot.description ?? ""}
          allowEmpty={hasDescription}
          maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
          isSaving={actions.updatingIds.has(screenshot.id)}
          sanitize={sanitizeScreenshotDescriptionInput}
          onSave={saveDescription}
        />
      ) : null}

      {isOwner && screenshot.descriptionModerationStatus === "BLOCKED" ? (
        <p className="screenshot-lightbox__description-note">
          {t("description_only_visible_to_you")}
        </p>
      ) : null}

      {!isOwner && hasDescription ? (
        <h2 className="screenshot-lightbox__description">
          {screenshot.description}
        </h2>
      ) : null}

      <p className="screenshot-lightbox__byline">
        <Link
          className="screenshot-lightbox__author screenshot-lightbox__byline-link"
          to={`/profile/${encodeURIComponent(screenshot.owner.id)}`}
          onClick={onClose}
        >
          <Avatar size={20} src={screenshot.owner.profileImageUrl} alt="" />
          {screenshot.owner.displayName}
        </Link>
        <span className="screenshot-lightbox__separator" aria-hidden="true">
          ·
        </span>
        <ScreenshotGameLink screenshot={screenshot} onNavigateAway={onClose} />
      </p>

      <time
        className="screenshot-lightbox__date"
        dateTime={new Date(screenshot.capturedAt).toISOString()}
      >
        {t("captured_on", { date: formatDateTime(screenshot.capturedAt) })}
      </time>
    </header>
  );
}

interface ScreenshotPanelActionsProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotActions;
  isOwner: boolean;
  isApproved: boolean;
  onRequestManage: () => void;
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

function ScreenshotPanelActions({
  screenshot,
  actions,
  isOwner,
  isApproved,
  onRequestManage,
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
  const { isHidden: isSensitiveHidden } = useSensitiveScreenshot(screenshot);
  const reportLabel = t(isReported ? "reported" : "report_screenshot");
  const deleteLabel = t("delete_screenshot");
  const manageLabel = t("manage_screenshot");

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

      <div className="screenshot-lightbox__action-group">
        <button
          type="button"
          className="screenshot-lightbox__action screenshot-lightbox__action--icon screenshot-lightbox__copy"
          onClick={() => void actions.copyImage(screenshot)}
          disabled={
            !screenshot.imageUrl ||
            isSensitiveHidden ||
            actions.copyingIds.has(screenshot.id)
          }
          aria-label={copyLabel}
          data-tooltip-id={tooltipId}
          data-tooltip-content={copyLabel}
        >
          <CopyIcon size={16} />
        </button>

        {isOwner ? (
          <button
            type="button"
            className="screenshot-lightbox__action screenshot-lightbox__action--icon screenshot-lightbox__manage"
            onClick={onRequestManage}
            disabled={actions.updatingIds.has(screenshot.id)}
            aria-label={manageLabel}
            data-tooltip-id={tooltipId}
            data-tooltip-content={manageLabel}
          >
            <GearIcon size={16} />
          </button>
        ) : null}

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
      </div>

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
  onPatch: (screenshotId: string, patch: ScreenshotPatch) => void;
  onFailure: (screenshotId: string, failure: ScreenshotFailure) => void;
  onClose: () => void;
  onRequestManage: () => void;
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

export function ScreenshotLightboxPanel({
  screenshot,
  actions,
  onPatch,
  onFailure,
  onClose,
  onRequestManage,
  onRequestDelete,
  onRequestReport,
}: Readonly<ScreenshotLightboxPanelProps>) {
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled, Feature } = useFeature();
  const isOwner = userDetails?.id === screenshot.owner.id;
  const isCommentsEnabled = isFeatureEnabled(Feature.ScreenshotComments);
  const isApproved = isScreenshotApproved(screenshot);

  return (
    <aside className="screenshot-lightbox__panel">
      <ScreenshotPanelInfo
        screenshot={screenshot}
        actions={actions}
        isOwner={isOwner}
        onClose={onClose}
      />

      <ScreenshotPanelActions
        screenshot={screenshot}
        actions={actions}
        isOwner={isOwner}
        isApproved={isApproved}
        onRequestManage={onRequestManage}
        onRequestDelete={onRequestDelete}
        onRequestReport={onRequestReport}
      />

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
