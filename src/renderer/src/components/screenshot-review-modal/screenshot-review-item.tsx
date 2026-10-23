import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ScreenFullIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot, ProfileVisibility } from "@types";
import {
  isScreenshotUploadRetryable,
  sanitizeScreenshotDescriptionInput,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_VISIBILITY_OPTIONS,
} from "@shared";
import {
  Button,
  CheckboxField,
  ConfirmationModal,
  InlineEditField,
  SelectField,
} from "@renderer/components";
import { logger } from "@renderer/logger";

import { ScreenshotReviewStatus } from "./screenshot-review-status";
import {
  getLocalImageSource,
  isScreenshotAwaitingReview,
  isScreenshotEditable,
  isScreenshotKeptLocally,
  toUploadOptions,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

const VISIBILITY_LABEL_KEYS: Record<ProfileVisibility, string> = {
  PUBLIC: "visibility_public",
  FRIENDS: "visibility_friends",
  PRIVATE: "visibility_private",
};

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
  canClose: boolean;
  onClose: () => void;
  notice?: React.ReactNode;
}

export function ScreenshotReviewItem({
  screenshot,
  draft,
  onDraftChange,
  onDraftCommit,
  onExpand,
  isDetailsOpen,
  onToggleDetails,
  canClose,
  onClose,
  notice,
}: Readonly<ScreenshotReviewItemProps>) {
  const { t, i18n } = useTranslation("screenshots_capture");
  const prefersReducedMotion = useReducedMotion();
  const [isBusy, setIsBusy] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const isCustomGame = screenshot.shop === "custom";
  const isTitleEditable = isCustomGame && isScreenshotEditable(screenshot);
  const isFormDisabled = isBusy || !isScreenshotEditable(screenshot);
  const capturedAt = new Date(screenshot.capturedAt).toLocaleString(
    i18n.language
  );
  const panelTransition = prefersReducedMotion
    ? { duration: 0 }
    : DETAILS_PANEL_SPRING;
  const contentTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: "easeOut" as const };

  const visibilityOptions = SCREENSHOT_VISIBILITY_OPTIONS.map((option) => ({
    key: option,
    value: option,
    label: t(VISIBILITY_LABEL_KEYS[option]),
  }));

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      logger.error(label, error);
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpload = () =>
    runAction(
      () =>
        window.electron.uploadLocalScreenshot(
          screenshot.clientId,
          toUploadOptions(screenshot, draft)
        ),
      "Failed to upload the screenshot"
    );

  const handleDescriptionSave = (description: string) => {
    onDraftChange({ ...draft, description });
    onDraftCommit?.();
    return true;
  };

  const handleTitleSave = (customGameTitle: string) => {
    onDraftChange({ ...draft, customGameTitle: customGameTitle.trim() });
    onDraftCommit?.();
    return true;
  };

  const handleDelete = () => {
    setIsDeleteModalVisible(false);
    void runAction(
      () => window.electron.deleteLocalScreenshot(screenshot.clientId),
      "Failed to delete the screenshot"
    );
  };

  const handleVisibilityChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const visibility = SCREENSHOT_VISIBILITY_OPTIONS.find(
      (option) => option === event.target.value
    );
    if (visibility) onDraftChange({ ...draft, visibility });
  };

  const renderDeleteButton = () => (
    <Button
      className="screenshot-review-item__delete"
      theme="danger"
      disabled={isBusy}
      tooltip={t("delete")}
      aria-label={t("delete")}
      onClick={() => setIsDeleteModalVisible(true)}
    >
      <TrashIcon size={16} />
    </Button>
  );

  const renderUploadButton = () => (
    <Button
      className="screenshot-review-item__upload"
      disabled={isBusy}
      onClick={handleUpload}
    >
      <UploadIcon size={16} />
      {t("upload")}
    </Button>
  );

  const renderCloseButton = () =>
    canClose && (
      <Button theme="outline" onClick={onClose}>
        {t("close")}
      </Button>
    );

  const renderActions = () => {
    if (
      isScreenshotAwaitingReview(screenshot) ||
      isScreenshotKeptLocally(screenshot)
    ) {
      return (
        <>
          {renderUploadButton()}
          {renderDeleteButton()}
        </>
      );
    }

    if (screenshot.state === "failed") {
      return (
        <>
          {renderCloseButton()}
          {isScreenshotUploadRetryable(screenshot.lastError) && (
            <Button disabled={isBusy} onClick={handleUpload}>
              {t("retry")}
            </Button>
          )}
          {renderDeleteButton()}
        </>
      );
    }

    if (screenshot.state === "uploaded") return renderCloseButton() || null;

    return null;
  };

  const actions = renderActions();
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
              {isTitleEditable && (
                <InlineEditField
                  className="screenshot-review-item__title-field"
                  label={t("custom_game_title_edit")}
                  placeholder={t("custom_game_default_title")}
                  initialValue={draft.customGameTitle}
                  maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
                  allowEmpty
                  disabled={isBusy}
                  onSave={handleTitleSave}
                />
              )}

              <InlineEditField
                className="screenshot-review-item__description"
                label={t("description_label")}
                placeholder={t("description_add")}
                initialValue={draft.description}
                maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
                sanitize={sanitizeScreenshotDescriptionInput}
                multiline
                allowEmpty
                disabled={isFormDisabled}
                onSave={handleDescriptionSave}
              />

              <div className="screenshot-review-item__checkbox">
                <CheckboxField
                  label={t("spoiler_label")}
                  checked={draft.isSpoiler}
                  disabled={isFormDisabled}
                  onChange={(event) =>
                    onDraftChange({ ...draft, isSpoiler: event.target.checked })
                  }
                />
                <small className="screenshot-review-item__hint">
                  {t("spoiler_hint")}
                </small>
              </div>

              <SelectField
                label={t("visibility_label")}
                value={draft.visibility}
                options={visibilityOptions}
                disabled={isFormDisabled}
                onChange={handleVisibilityChange}
                theme="dark"
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
          {notice || <ScreenshotReviewStatus screenshot={screenshot} />}
        </div>

        {actions && (
          <div className="screenshot-review-item__actions">{actions}</div>
        )}
      </footer>

      <ConfirmationModal
        visible={isDeleteModalVisible}
        title={t("delete_confirm_title")}
        descriptionText={t("delete_confirm_description")}
        confirmButtonLabel={t("delete_confirm_button")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={handleDelete}
        onClose={() => setIsDeleteModalVisible(false)}
      />
    </article>
  );
}
