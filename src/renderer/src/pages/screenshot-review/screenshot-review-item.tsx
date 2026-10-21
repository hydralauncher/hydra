import { useState } from "react";
import { TrashIcon, UploadIcon } from "@primer/octicons-react";
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
  TextField,
} from "@renderer/components";
import { logger } from "@renderer/logger";

import { ScreenshotReviewStatus } from "./screenshot-review-status";
import {
  ScreenshotReviewSplitButton,
  type ScreenshotReviewMenuAction,
} from "./screenshot-review-split-button";
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

interface ScreenshotReviewItemProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  onDraftCommit?: () => void;
  canClose: boolean;
  isLocked?: boolean;
  pendingCount?: number;
  onUploadAll?: () => void;
  onKeepAll?: () => void;
}

export function ScreenshotReviewItem({
  screenshot,
  draft,
  onDraftChange,
  onDraftCommit,
  canClose,
  isLocked = false,
  pendingCount = 0,
  onUploadAll,
  onKeepAll,
}: Readonly<ScreenshotReviewItemProps>) {
  const { t, i18n } = useTranslation("screenshots_capture");
  const [isActionBusy, setIsActionBusy] = useState(false);
  const isBusy = isActionBusy || isLocked;
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const isCustomGame = screenshot.shop === "custom";
  const isTitleEditable = isCustomGame && isScreenshotEditable(screenshot);
  const displayTitle =
    (isCustomGame && screenshot.customGameTitle) || screenshot.gameTitle;
  const isFormDisabled = isBusy || !isScreenshotEditable(screenshot);
  const capturedAt = new Date(screenshot.capturedAt).toLocaleString(
    i18n.language
  );

  const visibilityOptions = SCREENSHOT_VISIBILITY_OPTIONS.map((option) => ({
    key: option,
    value: option,
    label: t(VISIBILITY_LABEL_KEYS[option]),
  }));

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setIsActionBusy(true);
    try {
      await action();
    } catch (error) {
      logger.error(label, error);
    } finally {
      setIsActionBusy(false);
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

  const handleKeep = () =>
    runAction(
      () => window.electron.skipLocalScreenshot(screenshot.clientId),
      "Failed to keep the screenshot on this computer"
    );

  const hasBulkActions = pendingCount > 1;
  const uploadMenuActions: ScreenshotReviewMenuAction[] =
    hasBulkActions && onUploadAll
      ? [
          {
            label: t("upload_all", { count: pendingCount }),
            icon: <UploadIcon size={16} />,
            onSelect: onUploadAll,
          },
        ]
      : [];
  const keepMenuActions: ScreenshotReviewMenuAction[] =
    hasBulkActions && onKeepAll
      ? [{ label: t("keep_all", { count: pendingCount }), onSelect: onKeepAll }]
      : [];

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
    <ScreenshotReviewSplitButton
      className="screenshot-review-item__upload"
      disabled={isBusy}
      onClick={handleUpload}
      menuLabel={t("upload_more_options")}
      menuActions={uploadMenuActions}
    >
      <UploadIcon size={16} />
      {t("upload")}
    </ScreenshotReviewSplitButton>
  );

  const renderActions = () => {
    if (isScreenshotAwaitingReview(screenshot)) {
      return (
        <>
          {renderUploadButton()}
          <ScreenshotReviewSplitButton
            className="screenshot-review-item__keep"
            theme="outline"
            disabled={isBusy}
            onClick={handleKeep}
            menuLabel={t("keep_more_options")}
            menuActions={keepMenuActions}
          >
            {t("keep_on_computer")}
          </ScreenshotReviewSplitButton>
          {renderDeleteButton()}
        </>
      );
    }

    if (isScreenshotKeptLocally(screenshot)) {
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
          {isScreenshotUploadRetryable(screenshot.lastError) && (
            <Button disabled={isBusy} onClick={handleUpload}>
              {t("retry")}
            </Button>
          )}
          {renderDeleteButton()}
          {canClose && (
            <Button theme="outline" onClick={() => window.close()}>
              {t("close")}
            </Button>
          )}
        </>
      );
    }

    if (screenshot.state === "uploaded" && canClose) {
      return (
        <Button theme="outline" onClick={() => window.close()}>
          {t("close")}
        </Button>
      );
    }

    return null;
  };

  const actions = renderActions();

  return (
    <article
      className="screenshot-review-item"
      data-client-id={screenshot.clientId}
    >
      <div className="screenshot-review-item__body">
        <div className="screenshot-review-item__preview">
          <img
            src={getLocalImageSource(screenshot.path)}
            alt={t("screenshot_alt", {
              game: screenshot.gameTitle,
              date: capturedAt,
            })}
            className="screenshot-review-item__image"
            draggable={false}
          />
          <time
            className="screenshot-review-item__date"
            dateTime={new Date(screenshot.capturedAt).toISOString()}
          >
            {capturedAt}
          </time>
        </div>

        <div className="screenshot-review-item__meta">
          {isTitleEditable ? (
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
          ) : (
            <p className="screenshot-review-item__game" title={displayTitle}>
              {displayTitle}
            </p>
          )}
        </div>

        <div className="screenshot-review-item__form">
          <TextField
            label={t("description_label")}
            placeholder={t("description_placeholder")}
            hint={t("description_counter", {
              count: draft.description.length,
              max: SCREENSHOT_DESCRIPTION_MAX_LENGTH,
            })}
            maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
            value={draft.description}
            disabled={isFormDisabled}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                description: sanitizeScreenshotDescriptionInput(
                  event.target.value
                ),
              })
            }
            onBlur={onDraftCommit}
            theme="dark"
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
        </div>

        <ScreenshotReviewStatus screenshot={screenshot} />
      </div>

      {actions && (
        <div className="screenshot-review-item__actions">{actions}</div>
      )}

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
