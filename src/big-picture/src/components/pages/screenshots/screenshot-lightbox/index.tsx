import "./styles.scss";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { LocalScreenshot, ProfileScreenshot } from "@types";
import {
  AuthPage,
  getLocalScreenshotTitle,
  SCREENSHOT_REPORT_REASONS,
  toLocalScreenshotUrl,
  type ScreenshotPatch,
} from "@shared";

import { ConfirmationModal } from "../../../modals";
import {
  Feature,
  useActiveLayerId,
  useFeature,
  useUserDetails,
} from "../../../../hooks";
import type { FocusOverrides, FocusOverrideTarget } from "../../../../services";
import {
  MEDIA_VIEWER_STAGE_FOCUS_ID,
  MediaViewer,
} from "../../game/media-viewer";
import {
  getScreenshotBlurReason,
  getScreenshotGameTitle,
  shouldBlurScreenshot,
} from "../helpers";
import { ScreenshotManageModal } from "../screenshot-manage-modal";
import { ScreenshotReportModal } from "../screenshot-report-modal";
import { useRevealedScreenshotSpoilers } from "../use-revealed-spoilers";
import { useSensitiveScreenshotGate } from "../use-sensitive-screenshot-gate";
import { getScreenshotCommentsPanelFocusIds } from "./comment-focus-ids";
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

export type ScreenshotViewerEntry =
  | { kind: "local"; screenshot: LocalScreenshot }
  | { kind: "uploaded"; screenshot: ProfileScreenshot };

export interface ScreenshotLightboxLocalSlot {
  entries: ScreenshotViewerEntry[];
  openLocal: LocalScreenshot | null;
  onOpenEntry: (entry: ScreenshotViewerEntry) => void;
  onClose: () => void;
  getSidebarEntryFocusId: (screenshot: LocalScreenshot) => string | null;
  renderSidebar: (
    screenshot: LocalScreenshot,
    stageTarget: FocusOverrideTarget
  ) => ReactNode;
}

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
  localSlot?: ScreenshotLightboxLocalSlot;
}

const STAGE_TARGET: FocusOverrideTarget = {
  type: "item",
  itemId: MEDIA_VIEWER_STAGE_FOCUS_ID,
};

const getStageNavigationOverrides = (
  screenshot: ProfileScreenshot,
  viewerId: string | null,
  showComments: boolean
): FocusOverrides | undefined => {
  if (!showComments) return undefined;

  const focusIds = getScreenshotCommentsPanelFocusIds(screenshot.id);
  if (!viewerId) {
    return { right: { type: "item", itemId: focusIds.signIn } };
  }
  if (!screenshot.canComment) return undefined;
  return { right: { type: "item", itemId: focusIds.input } };
};

const getEntryId = (entry: ScreenshotViewerEntry) =>
  entry.kind === "local"
    ? `local:${entry.screenshot.clientId}`
    : entry.screenshot.id;

const getViewerEntries = (
  current: ScreenshotViewerEntry,
  entries: ScreenshotViewerEntry[]
) => {
  const currentId = getEntryId(current);
  const index = entries.findIndex((entry) => getEntryId(entry) === currentId);
  if (index < 0) return { list: [current], index: 0 };

  return {
    list: entries.map((entry) =>
      getEntryId(entry) === currentId ? current : entry
    ),
    index,
  };
};

type LightboxModal = "manage" | "report" | "delete" | null;

interface LightboxModalsProps {
  screenshot: ProfileScreenshot;
  openModal: LightboxModal;
  social: LightboxSocial;
  onCloseModal: () => void;
  onDeleted: (commitRemoval: () => void) => void;
  onDeleteExitComplete: () => void;
}

function LightboxModals({
  screenshot,
  openModal,
  social,
  onCloseModal,
  onDeleted,
  onDeleteExitComplete,
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
        onExitComplete={onDeleteExitComplete}
        onConfirm={async () => {
          const commitRemoval = await social.remove();
          if (commitRemoval) onDeleted(commitRemoval);
        }}
      />
    </>
  );
}

interface ScreenshotViewerProps {
  current: ScreenshotViewerEntry;
  entries: ScreenshotViewerEntry[];
  localSlot?: ScreenshotLightboxLocalSlot;
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
  current,
  entries,
  localSlot,
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
  const sensitiveGate = useSensitiveScreenshotGate();
  const { list, index } = useMemo(
    () => getViewerEntries(current, entries),
    [current, entries]
  );
  const entriesById = useMemo(
    () => new Map(list.map((entry) => [getEntryId(entry), entry])),
    [list]
  );
  const mediaItems = useMemo(
    () =>
      list.map((entry) =>
        entry.kind === "local"
          ? {
              id: getEntryId(entry),
              type: "image" as const,
              src: toLocalScreenshotUrl(entry.screenshot.path),
              thumbnail: toLocalScreenshotUrl(
                entry.screenshot.previewPath ?? entry.screenshot.path
              ),
              alt: getLocalScreenshotTitle(entry.screenshot),
            }
          : {
              id: entry.screenshot.id,
              type: "image" as const,
              src: entry.screenshot.imageUrl ?? undefined,
              thumbnail: entry.screenshot.thumbnailUrl ?? undefined,
              alt: getScreenshotGameTitle(entry.screenshot, t),
            }
      ),
    [list, t]
  );
  const getBlurReason = (target: ProfileScreenshot) => {
    if (!target.imageUrl) return null;

    return getScreenshotBlurReason(
      sensitiveGate.isHidden(target),
      shouldBlurScreenshot(target, revealedIds)
    );
  };
  const revealTarget = (target: ProfileScreenshot) => {
    if (getBlurReason(target) === "sensitive") {
      sensitiveGate.guard(target, () => {});
      return;
    }

    revealSpoiler(target.id);
  };
  const uploaded = current.kind === "uploaded" ? current.screenshot : null;
  const stageNavigationOverrides = useMemo<FocusOverrides | undefined>(() => {
    if (current.kind === "local") {
      const entryFocusId = localSlot?.getSidebarEntryFocusId(
        current.screenshot
      );
      if (!entryFocusId) return undefined;
      return { right: { type: "item", itemId: entryFocusId } };
    }
    return getStageNavigationOverrides(
      current.screenshot,
      viewerId,
      showComments
    );
  }, [current, localSlot, viewerId, showComments]);

  const renderSidebar = () => {
    if (current.kind === "local") {
      return localSlot?.renderSidebar(current.screenshot, STAGE_TARGET) ?? null;
    }

    return (
      <ScreenshotLightboxSidebar
        screenshot={current.screenshot}
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
    );
  };

  return (
    <>
      <MediaViewer
        items={mediaItems}
        index={index}
        className="screenshot-viewer"
        stageNavigationOverrides={stageNavigationOverrides}
        showFilmstrip={false}
        showCounter={false}
        canNavigatePastEnd={uploaded !== null && canLoadMore}
        onNavigatePastEnd={onLoadMore}
        onNavigate={(nextIndex) => {
          const target = list[nextIndex];
          if (!target) return;
          if (localSlot) localSlot.onOpenEntry(target);
          else if (target.kind === "uploaded") onSelect?.(target.screenshot);
        }}
        onClose={onClose}
        onStagePrimary={() => {
          if (!uploaded) return;
          if (getBlurReason(uploaded)) revealTarget(uploaded);
          else if (hasLoadMoreError) onLoadMore?.();
        }}
        renderImage={({ item, className, onLoad, onPreviewReady, onError }) => {
          const entry = entriesById.get(item.id);
          if (!entry) return null;

          if (entry.kind === "local") {
            return (
              <img
                className={className}
                src={item.src}
                alt={item.alt}
                draggable={false}
                onLoad={onLoad}
                onError={onError}
              />
            );
          }

          const target = entry.screenshot;
          return (
            <>
              <ScreenshotStageImage
                screenshot={target}
                className={className}
                blurReason={getBlurReason(target)}
                onLoad={onLoad}
                onPreviewReady={onPreviewReady}
                onError={onError}
                onReveal={() => revealTarget(target)}
                onRefreshImage={onRefreshImage}
              />
              {hasLoadMoreError && target.id === uploaded?.id ? (
                <LoadMoreErrorNotice onRetry={onLoadMore} />
              ) : null}
            </>
          );
        }}
        sidebar={renderSidebar()}
      />
      {sensitiveGate.modal}
    </>
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
  localSlot,
}: Readonly<ScreenshotLightboxProps>) {
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled } = useFeature();
  const navigate = useNavigate();
  const [openModal, setOpenModal] = useState<LightboxModal>(null);
  const statusLayerIdRef = useRef<string | null>(null);
  const reportStatusLayer = useCallback((layerId: string | null) => {
    statusLayerIdRef.current = layerId;
  }, []);
  const activeLayerId = useActiveLayerId();
  const isViewerCovered =
    statusLayerIdRef.current !== null &&
    activeLayerId !== statusLayerIdRef.current;
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

  const openLocal = localSlot?.openLocal ?? null;
  const closeViewer = localSlot?.onClose ?? onClose;
  const pendingRemovalRef = useRef<(() => void) | null>(null);
  const [hasDeleteModalExited, setHasDeleteModalExited] = useState(false);

  useEffect(() => {
    if (!hasDeleteModalExited) return;

    setHasDeleteModalExited(false);
    const commitRemoval = pendingRemovalRef.current;
    pendingRemovalRef.current = null;
    if (!commitRemoval) return;

    commitRemoval();
    closeViewer();
  }, [closeViewer, hasDeleteModalExited]);

  const viewerEntries = useMemo<ScreenshotViewerEntry[]>(
    () =>
      localSlot?.entries ??
      items.map((item) => ({ kind: "uploaded" as const, screenshot: item })),
    [items, localSlot?.entries]
  );

  const getCurrentEntry = (): ScreenshotViewerEntry | null => {
    if (openLocal) return { kind: "local", screenshot: openLocal };
    if (status !== "ready" || !screenshot || isViewerCovered) return null;
    return { kind: "uploaded", screenshot };
  };
  const currentEntry = getCurrentEntry();

  if (status === null && !openLocal) return null;

  if (!currentEntry) {
    return (
      <ScreenshotLightboxStatusPanel
        status={status === "ready" || status === null ? "loading" : status}
        onClose={closeViewer}
        onLayerIdChange={reportStatusLayer}
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
        current={currentEntry}
        entries={viewerEntries}
        localSlot={localSlot}
        canLoadMore={canLoadMore}
        hasLoadMoreError={hasLoadMoreError}
        viewerId={viewerId}
        isOwner={isOwner}
        showComments={isFeatureEnabled(Feature.ScreenshotComments)}
        social={social}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
        onClose={closeViewer}
        onUpdate={onUpdate}
        onRefreshImage={onRefreshImage}
        onRequestReport={requestReport}
        onRequestManage={() => setOpenModal("manage")}
        onRequestDelete={() => setOpenModal("delete")}
        onNavigateAway={(path) => {
          closeViewer();
          navigate(path);
        }}
      />
      {!openLocal && screenshot ? (
        <LightboxModals
          screenshot={screenshot}
          openModal={openModal}
          social={social}
          onCloseModal={() => setOpenModal(null)}
          onDeleted={(commitRemoval) => {
            pendingRemovalRef.current = commitRemoval;
            setOpenModal(null);
          }}
          onDeleteExitComplete={() => {
            if (pendingRemovalRef.current) setHasDeleteModalExited(true);
          }}
        />
      ) : null}
    </>
  );
}
