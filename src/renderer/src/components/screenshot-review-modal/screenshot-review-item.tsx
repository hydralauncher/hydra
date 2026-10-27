import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ScreenFullIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { LocalScreenshot } from "@types";
import { resolveScreenshotUploadQuality } from "@shared";
import { Button } from "@renderer/components";
import { useUserDetails } from "@renderer/hooks";

import { ScreenshotReviewActionButtons } from "./screenshot-review-action-buttons";
import { ScreenshotReviewFields } from "./screenshot-review-fields";
import { ScreenshotReviewStatus } from "./screenshot-review-status";
import {
  getLocalImageSource,
  isScreenshotUndecided,
  SCREENSHOT_QUALITY_LABELS,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";
import { useScreenshotReviewActions } from "./use-screenshot-review-actions";

const DETAILS_PANEL_WIDTH = 384;
const DETAILS_PANEL_SPRING = {
  type: "spring",
  stiffness: 380,
  damping: 38,
  mass: 0.9,
} as const;
const DETAILS_CONTENT_OFFSET = 32;

interface ScreenshotReviewItemProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  onDraftCommit?: () => void;
  onExpand: () => void;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  hasNext: boolean;
  onNext: () => void;
}

export function ScreenshotReviewItem({
  screenshot,
  draft,
  onDraftChange,
  onDraftCommit,
  onExpand,
  isDetailsOpen,
  onToggleDetails,
  hasNext,
  onNext,
}: Readonly<ScreenshotReviewItemProps>) {
  const { t, i18n } = useTranslation("screenshots_capture");
  const prefersReducedMotion = useReducedMotion();
  const { hasActiveSubscription } = useUserDetails();
  const { isBusy, upload, requestDelete, elements } =
    useScreenshotReviewActions(screenshot, draft);

  const capturedAt = new Date(screenshot.capturedAt).toLocaleString(
    i18n.language
  );
  const uploadQuality = resolveScreenshotUploadQuality(
    draft.quality,
    hasActiveSubscription
  );
  const badgeQuality = isScreenshotUndecided(screenshot)
    ? uploadQuality
    : (screenshot.uploadQuality ?? null);
  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : DETAILS_PANEL_SPRING;
  const contentTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: "easeOut" as const };

  const actions = (
    <ScreenshotReviewActionButtons
      screenshot={screenshot}
      isBusy={isBusy}
      next={{ hasNext, onNext }}
      onUpload={() => void upload()}
      onRequestDelete={requestDelete}
    />
  );
  const detailsLabel = isDetailsOpen ? t("hide_details") : t("show_details");

  return (
    <article
      className="screenshot-review-item"
      data-client-id={screenshot.clientId}
    >
      <div className="screenshot-review-item__media">
        <button
          type="button"
          className="screenshot-review-item__preview"
          onClick={onExpand}
          aria-label={t("screenshot_alt", {
            game: screenshot.gameTitle,
            date: capturedAt,
          })}
        >
          <img
            src={getLocalImageSource(screenshot.previewPath ?? screenshot.path)}
            alt=""
            className="screenshot-review-item__image"
            draggable={false}
          />
          {badgeQuality && (
            <span
              className={cn("screenshot-review-item__quality", {
                "screenshot-review-item__quality--cloud":
                  badgeQuality === "CLOUD",
              })}
            >
              {SCREENSHOT_QUALITY_LABELS[badgeQuality]}
            </span>
          )}
          <span className="screenshot-review-item__expand" aria-hidden>
            <ScreenFullIcon size={16} />
          </span>
          <time
            className="screenshot-review-item__date"
            dateTime={new Date(screenshot.capturedAt).toISOString()}
          >
            {capturedAt}
          </time>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isDetailsOpen && (
          <motion.aside
            key="details"
            id={`screenshot-review-details-${screenshot.clientId}`}
            className="screenshot-review-item__side"
            initial={{ width: 0 }}
            animate={{ width: DETAILS_PANEL_WIDTH }}
            exit={{ width: 0 }}
            transition={panelTransition}
          >
            <motion.div
              className="screenshot-review-item__side-content"
              style={{ width: DETAILS_PANEL_WIDTH }}
              initial={{ opacity: 0, x: DETAILS_CONTENT_OFFSET }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: DETAILS_CONTENT_OFFSET }}
              transition={contentTransition}
            >
              <ScreenshotReviewFields
                screenshot={screenshot}
                draft={draft}
                isBusy={isBusy}
                onDraftChange={onDraftChange}
                onDraftCommit={onDraftCommit}
              />
            </motion.div>
          </motion.aside>
        )}
      </AnimatePresence>

      <footer className="screenshot-review-item__footer">
        <Button
          theme="outline"
          className="screenshot-review-item__details-toggle"
          aria-expanded={isDetailsOpen}
          aria-controls={`screenshot-review-details-${screenshot.clientId}`}
          onClick={onToggleDetails}
        >
          {isDetailsOpen ? (
            <SidebarCollapseIcon size={16} />
          ) : (
            <SidebarExpandIcon size={16} />
          )}
          {detailsLabel}
        </Button>

        <div className="screenshot-review-item__footer-status">
          <ScreenshotReviewStatus screenshot={screenshot} />
        </div>

        <div className="screenshot-review-item__actions">{actions}</div>
      </footer>

      {elements}
    </article>
  );
}
