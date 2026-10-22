import "./styles.scss";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { ProfileScreenshot } from "@types";
import {
  AuthPage,
  SCREENSHOT_REPORT_REASONS,
  type ScreenshotPatch,
} from "@shared";

import { ConfirmationModal } from "../../../modals";
import { Feature, useFeature, useUserDetails } from "../../../../hooks";
import type { FocusOverrideTarget } from "../../../../services";
import {
  MEDIA_VIEWER_STAGE_FOCUS_ID,
  MediaViewer,
} from "../../game/media-viewer";
import { getScreenshotGameTitle, shouldBlurScreenshot } from "../helpers";
import { ScreenshotManageModal } from "../screenshot-manage-modal";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import { ScreenshotDialogPresence } from "../screenshot-dialog-presence";
import { useRevealedScreenshotSpoilers } from "../use-revealed-spoilers";
import { ScreenshotLightboxSidebar } from "./sidebar";
import {
  useLightboxSocialActions,
  type LightboxSocial,
} from "./social-actions";
import { ScreenshotLightboxStatusPanel } from "./status-panel";
import { ScreenshotStageImage } from "./stage-image";

export type ScreenshotLightboxStatus =
  | "loading"
  | "ready"
  | "private"
  | "unavailable";

export interface ScreenshotLightboxProps {
  status: ScreenshotLightboxStatus | null;
  screenshot: ProfileScreenshot | null;
  items?: ProfileScreenshot[];
  canLoadMore?: boolean;
  hasLoadMoreError?: boolean;
  onSelect?: (screenshot: ProfileScreenshot) => void;
  onLoadMore?: () => void;
  onClose: () => void;
  onUpdate: (screenshotId: string, update: ScreenshotPatch) => void;
  onRemove: (screenshotId: string, ownerId: string) => void;
  onUnavailable: (screenshotId: string, ownerId: string) => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

const STAGE_TARGET: FocusOverrideTarget = {
  type: "item",
  itemId: MEDIA_VIEWER_STAGE_FOCUS_ID,
};

const getViewerScreenshots = (
  screenshot: ProfileScreenshot,
  items: ProfileScreenshot[]
) => {
  const index = items.findIndex((item) => item.id === screenshot.id);
  if (index < 0) return { list: [screenshot], index: 0 };

  return {
    list: items.map((item) => (item.id === screenshot.id ? screenshot : item)),
    index,
  };
};

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
      <ScreenshotDialogPresence isOpen={openModal === "delete"} />
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

interface ScreenshotViewerProps {
  screenshot: ProfileScreenshot;
  items: ProfileScreenshot[];
  canLoadMore: boolean;
  hasLoadMoreError: boolean;
  viewerId: string | null;
  isOwner: boolean;
  showComments: boolean;
  social: LightboxSocial;
  onSelect?: (screenshot: ProfileScreenshot) => void;
  onLoadMore?: () => void;
  onClose: () => void;
  onUpdate: (screenshotId: string, update: ScreenshotPatch) => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
  onRequestReport: () => void;
  onRequestManage: () => void;
  onRequestDelete: () => void;
  onNavigateAway: (path: string) => void;
}

function LoadMoreErrorNotice({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  const { t } = useTranslation("big_picture");

  return (
    <output className="screenshot-viewer__load-error">
      <span>{t("screenshots_load_more_failed")}</span>
      <button
        type="button"
        className="screenshot-viewer__reveal"
        tabIndex={-1}
        onClick={onRetry}
      >
        <ArrowClockwiseIcon size={18} />
        {t("screenshots_retry")}
      </button>
    </output>
  );
}

function ScreenshotViewer({
  screenshot,
  items,
  canLoadMore,
  hasLoadMoreError,
  viewerId,
  isOwner,
  showComments,
  social,
  onSelect,
  onLoadMore,
  onClose,
  onUpdate,
  onRefreshImage,
  onRequestReport,
  onRequestManage,
  onRequestDelete,
  onNavigateAway,
}: Readonly<ScreenshotViewerProps>) {
  const { t } = useTranslation("big_picture");
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const revealSpoiler = useRevealedScreenshotSpoilers((state) => state.reveal);
  const { list, index } = useMemo(
    () => getViewerScreenshots(screenshot, items),
    [items, screenshot]
  );
  const screenshotsById = useMemo(
    () => new Map(list.map((item) => [item.id, item])),
    [list]
  );
  const mediaItems = useMemo(
    () =>
      list.map((item) => ({
        id: item.id,
        type: "image" as const,
        src: item.imageUrl ?? undefined,
        thumbnail: item.thumbnailUrl ?? undefined,
        alt: getScreenshotGameTitle(item, t),
      })),
    [list, t]
  );
  const isBlurred = (target: ProfileScreenshot) =>
    shouldBlurScreenshot(target, revealedIds) && Boolean(target.imageUrl);

  return (
    <MediaViewer
      items={mediaItems}
      index={index}
      className="screenshot-viewer"
      showFilmstrip={false}
      showCounter={false}
      canNavigatePastEnd={canLoadMore}
      onNavigatePastEnd={onLoadMore}
      onNavigate={(nextIndex) => {
        const target = list[nextIndex];
        if (target) onSelect?.(target);
      }}
      onClose={onClose}
      onStagePrimary={() => {
        if (isBlurred(screenshot)) revealSpoiler(screenshot.id);
        else if (hasLoadMoreError) onLoadMore?.();
      }}
      renderImage={({ item, className, onLoad, onError }) => {
        const target = screenshotsById.get(item.id);
        if (!target) return null;

        return (
          <>
            <ScreenshotStageImage
              screenshot={target}
              className={className}
              isBlurred={isBlurred(target)}
              onLoad={onLoad}
              onError={onError}
              onReveal={() => revealSpoiler(target.id)}
              onRefreshImage={onRefreshImage}
            />
            {hasLoadMoreError && target.id === screenshot.id ? (
              <LoadMoreErrorNotice onRetry={onLoadMore} />
            ) : null}
          </>
        );
      }}
      sidebar={
        <ScreenshotLightboxSidebar
          screenshot={screenshot}
          viewerId={viewerId}
          isOwner={isOwner}
          showComments={showComments}
          social={social}
          stageTarget={STAGE_TARGET}
          onUpdate={onUpdate}
          onRequestReport={onRequestReport}
          onRequestManage={onRequestManage}
          onRequestDelete={onRequestDelete}
          onNavigate={onNavigateAway}
        />
      }
    />
  );
}

export function ScreenshotLightbox({
  status,
  screenshot,
  items = [],
  canLoadMore = false,
  hasLoadMoreError = false,
  onSelect,
  onLoadMore,
  onClose,
  onUpdate,
  onRemove,
  onUnavailable,
  onRefreshImage,
}: Readonly<ScreenshotLightboxProps>) {
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled } = useFeature();
  const navigate = useNavigate();
  const [openModal, setOpenModal] = useState<LightboxModal>(null);
  const viewerId = userDetails?.id ?? null;
  const isOwner = viewerId !== null && screenshot?.owner.id === viewerId;
  const social = useLightboxSocialActions({
    screenshot,
    isSignedIn: viewerId !== null,
    onUpdate,
    onRemove,
    onUnavailable,
  });

  useEffect(() => {
    setOpenModal(null);
  }, [screenshot?.id, status]);

  if (status === null) return null;

  if (status !== "ready" || !screenshot) {
    return (
      <ScreenshotLightboxStatusPanel
        status={status === "ready" ? "loading" : status}
        onClose={onClose}
      />
    );
  }

  const requestReport = () => {
    if (viewerId) {
      setOpenModal("report");
      return;
    }

    void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
  };

  return (
    <>
      <ScreenshotViewer
        screenshot={screenshot}
        items={items}
        canLoadMore={canLoadMore}
        hasLoadMoreError={hasLoadMoreError}
        viewerId={viewerId}
        isOwner={isOwner}
        showComments={isFeatureEnabled(Feature.ScreenshotComments)}
        social={social}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
        onClose={onClose}
        onUpdate={onUpdate}
        onRefreshImage={onRefreshImage}
        onRequestReport={requestReport}
        onRequestManage={() => setOpenModal("manage")}
        onRequestDelete={() => setOpenModal("delete")}
        onNavigateAway={(path) => {
          onClose();
          navigate(path);
        }}
      />
      <LightboxModals
        screenshot={screenshot}
        openModal={openModal}
        social={social}
        onCloseModal={() => setOpenModal(null)}
        onDeleted={() => {
          setOpenModal(null);
          onClose();
        }}
      />
    </>
  );
}
