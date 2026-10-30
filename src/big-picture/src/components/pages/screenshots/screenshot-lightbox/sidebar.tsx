import {
  PlusIcon,
  FlagIcon,
  GameControllerIcon,
  GearSixIcon,
  HeartIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot, ProfileVisibility } from "@types";
import {
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  buildScreenshotSettingsUpdate,
  sanitizeScreenshotDescriptionInput,
  readScreenshotSettings,
  type ScreenshotPatch,
} from "@shared";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Typography,
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
import { InlineTextField } from "../inline-text-field";
import type { LightboxSocial } from "./social-actions";

const SIDEBAR_REGION_ID = "screenshot-viewer-sidebar";

export const getLightboxFocusIds = (screenshotId: string) => ({
  actions: `screenshot-lightbox-actions:${screenshotId}`,
  like: `screenshot-lightbox-like:${screenshotId}`,
  report: `screenshot-lightbox-report:${screenshotId}`,
  manage: `screenshot-lightbox-manage:${screenshotId}`,
  remove: `screenshot-lightbox-delete:${screenshotId}`,
  summary: `screenshot-lightbox-summary:${screenshotId}`,
  byline: `screenshot-lightbox-byline:${screenshotId}`,
  description: `screenshot-lightbox-description:${screenshotId}`,
  game: `screenshot-lightbox-game:${screenshotId}`,
  owner: `screenshot-lightbox-owner:${screenshotId}`,
});

interface LightboxSummaryProps {
  screenshot: ProfileScreenshot;
  focusIds: ReturnType<typeof getLightboxFocusIds>;
  stageTarget: FocusOverrideTarget;
  isOwner: boolean;
  onSaveDescription: (description: string) => Promise<boolean>;
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

const VISIBILITY_LABEL_KEYS: Record<ProfileVisibility, string> = {
  PUBLIC: "screenshots_visibility_public",
  FRIENDS: "screenshots_visibility_friends",
  PRIVATE: "screenshots_visibility_private",
};

function LightboxSummary({
  screenshot,
  focusIds,
  stageTarget,
  isOwner,
  onSaveDescription,
  onNavigate,
}: Readonly<LightboxSummaryProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const gameTitle = getScreenshotGameTitle(screenshot, t);
  const gamePath = getScreenshotGamePath(screenshot);
  const ownerPath = getScreenshotOwnerPath(screenshot.owner.id);

  const gameContent = (
    <>
      <LightboxGameIcon screenshot={screenshot} />
      <span className="screenshot-lightbox__game-title">{gameTitle}</span>
    </>
  );

  return (
    <VerticalFocusGroup regionId={focusIds.summary} asChild>
      <div className="screenshot-lightbox__summary">
        {isOwner ? (
          <InlineTextField
            key={screenshot.id}
            focusId={focusIds.description}
            className="screenshot-lightbox__description-field"
            label={t("screenshots_description_label")}
            value={screenshot.description ?? ""}
            placeholder={t("screenshots_add_description")}
            icon={<PlusIcon size={18} weight="bold" />}
            maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
            allowEmpty
            navigationOrder={0}
            navigationOverrides={{ left: stageTarget }}
            sanitize={sanitizeScreenshotDescriptionInput}
            onSave={onSaveDescription}
          />
        ) : null}
        {!isOwner && screenshot.description ? (
          <Typography variant="h4" className="screenshot-lightbox__description">
            {screenshot.description}
          </Typography>
        ) : null}
        <HorizontalFocusGroup regionId={focusIds.byline} asChild>
          <div className="screenshot-lightbox__byline">
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
                <span className="screenshot-lightbox__owner-name">
                  {screenshot.owner.displayName}
                </span>
              </button>
            </FocusItem>
            <span className="screenshot-lightbox__meta-separator" aria-hidden />
            {gamePath ? (
              <FocusItem
                id={focusIds.game}
                navigationOverrides={{ right: { type: "block" } }}
                asChild
              >
                <button
                  type="button"
                  className="screenshot-lightbox__game screenshot-lightbox__link"
                  title={t("screenshots_open_game")}
                  onClick={() => onNavigate(gamePath)}
                >
                  {gameContent}
                </button>
              </FocusItem>
            ) : (
              <span className="screenshot-lightbox__game">
                {gameContent}
                {screenshot.isCustomGame ? (
                  <span className="screenshot-lightbox__tag">
                    {t("screenshots_custom_game_tag")}
                  </span>
                ) : null}
              </span>
            )}
          </div>
        </HorizontalFocusGroup>
        <div className="screenshot-lightbox__date-row">
          <span className="screenshot-lightbox__date">
            {formatScreenshotDate(screenshot.capturedAt, language)}
          </span>
          {isOwner && screenshot.visibility ? (
            <span className="screenshot-lightbox__tag">
              {t(VISIBILITY_LABEL_KEYS[screenshot.visibility])}
            </span>
          ) : null}
        </div>
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
  onLike: () => void;
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
  onLike,
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

        <div className="screenshot-lightbox__action-group">
          {isOwner ? (
            <>
              <Button
                variant="secondary"
                size="icon"
                focusId={focusIds.manage}
                icon={<GearSixIcon size={20} />}
                aria-label={t("screenshots_manage")}
                title={t("screenshots_manage")}
                onClick={onManage}
              >
                {null}
              </Button>
              <Button
                variant="danger"
                size="icon"
                focusId={focusIds.remove}
                icon={<TrashIcon size={20} />}
                aria-label={t("screenshots_delete")}
                title={t("screenshots_delete")}
                focusNavigationOverrides={{ right: { type: "block" } }}
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
              focusNavigationOverrides={{ right: { type: "block" } }}
              onClick={onReport}
            >
              {t(isReported ? "screenshots_reported" : "screenshots_report")}
            </Button>
          )}
        </div>
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
            isOwner={isOwner}
            onSaveDescription={(description: string) =>
              social.save(
                buildScreenshotSettingsUpdate(screenshot, {
                  ...readScreenshotSettings(screenshot),
                  description,
                })
              )
            }
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
            onLike={() => void social.toggleLike()}
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
            onScreenshotUpdate={onUpdate}
          />
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}
