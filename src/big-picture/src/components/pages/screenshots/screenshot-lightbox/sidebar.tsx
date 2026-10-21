import {
  CaretRightIcon,
  CopyIcon,
  FlagIcon,
  GameControllerIcon,
  GearSixIcon,
  HeartIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import type { ScreenshotPatch } from "@shared";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "../../../common";
import type { FocusOverrideTarget } from "../../../../services";
import {
  formatScreenshotDate,
  getScreenshotGamePath,
  getScreenshotGameTitle,
  getScreenshotOwnerPath,
} from "../helpers";
import { ScreenshotCommentsPanel } from "./comments-panel";
import type { LightboxSocial } from "./social-actions";

const SIDEBAR_REGION_ID = "screenshot-viewer-sidebar";

export const getLightboxFocusIds = (screenshotId: string) => ({
  actions: `screenshot-lightbox-actions:${screenshotId}`,
  like: `screenshot-lightbox-like:${screenshotId}`,
  report: `screenshot-lightbox-report:${screenshotId}`,
  manage: `screenshot-lightbox-manage:${screenshotId}`,
  remove: `screenshot-lightbox-delete:${screenshotId}`,
  copy: `screenshot-lightbox-copy:${screenshotId}`,
  summary: `screenshot-lightbox-summary:${screenshotId}`,
  game: `screenshot-lightbox-game:${screenshotId}`,
  owner: `screenshot-lightbox-owner:${screenshotId}`,
});

interface LightboxSummaryProps {
  screenshot: ProfileScreenshot;
  focusIds: ReturnType<typeof getLightboxFocusIds>;
  stageTarget: FocusOverrideTarget;
  onNavigate: (path: string) => void;
}

function LightboxGameIcon({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const hasGameIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );

  return (
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
  );
}

function LightboxSummary({
  screenshot,
  focusIds,
  stageTarget,
  onNavigate,
}: Readonly<LightboxSummaryProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const gameTitle = getScreenshotGameTitle(screenshot, t);
  const gamePath = getScreenshotGamePath(screenshot);
  const ownerPath = getScreenshotOwnerPath(screenshot.owner.id);

  return (
    <VerticalFocusGroup regionId={focusIds.summary} asChild>
      <div className="screenshot-lightbox__summary">
        {gamePath ? (
          <FocusItem
            id={focusIds.game}
            navigationOverrides={{ left: stageTarget }}
            asChild
          >
            <button
              type="button"
              className="screenshot-lightbox__game screenshot-lightbox__link"
              title={t("screenshots_open_game")}
              onClick={() => onNavigate(gamePath)}
            >
              <LightboxGameIcon screenshot={screenshot} />
              <span className="screenshot-lightbox__game-title">
                {gameTitle}
              </span>
              <CaretRightIcon
                size={16}
                className="screenshot-lightbox__link-caret"
              />
            </button>
          </FocusItem>
        ) : (
          <div className="screenshot-lightbox__game">
            <LightboxGameIcon screenshot={screenshot} />
            <span className="screenshot-lightbox__game-title">{gameTitle}</span>
            {screenshot.isCustomGame ? (
              <span className="screenshot-lightbox__tag">
                {t("screenshots_custom_game_tag")}
              </span>
            ) : null}
          </div>
        )}
        <div className="screenshot-lightbox__meta">
          <FocusItem
            id={focusIds.owner}
            navigationOverrides={{ left: stageTarget }}
            asChild
          >
            <button
              type="button"
              className="screenshot-lightbox__owner screenshot-lightbox__link"
              title={t("screenshots_open_profile")}
              onClick={() => onNavigate(ownerPath)}
            >
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
            </button>
          </FocusItem>
          <span className="screenshot-lightbox__meta-separator" aria-hidden />
          <span>{formatScreenshotDate(screenshot.capturedAt, language)}</span>
        </div>
        {screenshot.description ? (
          <p className="screenshot-lightbox__description">
            {screenshot.description}
          </p>
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}

function getLikeLabelKey(likedByMe: boolean, isSignedIn: boolean) {
  if (!isSignedIn) return "screenshots_sign_in_to_like";

  return likedByMe ? "screenshots_unlike" : "screenshots_like";
}

interface LightboxActionsProps {
  screenshot: ProfileScreenshot;
  focusIds: ReturnType<typeof getLightboxFocusIds>;
  stageTarget: FocusOverrideTarget;
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
  stageTarget,
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
    <HorizontalFocusGroup regionId={focusIds.actions} asChild>
      <div className="screenshot-lightbox__actions">
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.like}
          focusNavigationOverrides={{ left: stageTarget }}
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
      </div>
    </HorizontalFocusGroup>
  );
}

export interface ScreenshotLightboxSidebarProps {
  screenshot: ProfileScreenshot;
  viewerId: string | null;
  isOwner: boolean;
  showComments: boolean;
  social: LightboxSocial;
  stageTarget: FocusOverrideTarget;
  onUpdate: (screenshotId: string, update: ScreenshotPatch) => void;
  onRequestReport: () => void;
  onRequestManage: () => void;
  onRequestDelete: () => void;
  onNavigate: (path: string) => void;
}

export function ScreenshotLightboxSidebar({
  screenshot,
  viewerId,
  isOwner,
  showComments,
  social,
  stageTarget,
  onUpdate,
  onRequestReport,
  onRequestManage,
  onRequestDelete,
  onNavigate,
}: Readonly<ScreenshotLightboxSidebarProps>) {
  const focusIds = getLightboxFocusIds(screenshot.id);

  const handleCommentCountChange = useCallback(
    (screenshotId: string, delta: number) => {
      onUpdate(screenshotId, (current) => ({
        commentCount: Math.max(0, current.commentCount + delta),
      }));
    },
    [onUpdate]
  );

  return (
    <VerticalFocusGroup regionId={SIDEBAR_REGION_ID} asChild>
      <div
        className={cn("screenshot-viewer-sidebar", {
          "screenshot-viewer-sidebar--with-comments": showComments,
        })}
      >
        <div className="screenshot-viewer-sidebar__details">
          <LightboxSummary
            screenshot={screenshot}
            focusIds={focusIds}
            stageTarget={stageTarget}
            onNavigate={onNavigate}
          />
          <LightboxActions
            screenshot={screenshot}
            focusIds={focusIds}
            stageTarget={stageTarget}
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

        {showComments ? (
          <ScreenshotCommentsPanel
            key={screenshot.id}
            screenshot={screenshot}
            viewerId={viewerId}
            isOwner={isOwner}
            leftTarget={stageTarget}
            onCommentCountChange={handleCommentCountChange}
          />
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}
