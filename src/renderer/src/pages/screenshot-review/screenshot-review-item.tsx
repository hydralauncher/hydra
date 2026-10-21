import { useState } from "react";
import { TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot, ProfileVisibility } from "@types";
import {
  isScreenshotUploadRetryable,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_VISIBILITY_OPTIONS,
} from "@shared";
import {
  Button,
  CheckboxField,
  ConfirmationModal,
  SelectField,
  TextField,
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

interface ScreenshotReviewItemProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  canClose: boolean;
  isLocked?: boolean;
}

export function ScreenshotReviewItem({
  screenshot,
  draft,
  onDraftChange,
  canClose,
  isLocked = false,
}: Readonly<ScreenshotReviewItemProps>) {
  const { t, i18n } = useTranslation("screenshots_capture");
  const [isActionBusy, setIsActionBusy] = useState(false);
  const isBusy = isActionBusy || isLocked;
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const isCustomGame = screenshot.shop === "custom";
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

  const handleSkip = () =>
    runAction(
      () => window.electron.skipLocalScreenshot(screenshot.clientId),
      "Failed to skip the screenshot"
    );

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
      theme="outline"
      disabled={isBusy}
      onClick={() => setIsDeleteModalVisible(true)}
    >
      <TrashIcon size={14} />
      {t("delete")}
    </Button>
  );

  const renderActions = () => {
    if (isScreenshotAwaitingReview(screenshot)) {
      return (
        <>
          <Button disabled={isBusy} onClick={handleUpload}>
            {t("upload")}
          </Button>
          <Button theme="outline" disabled={isBusy} onClick={handleSkip}>
            {t("skip")}
          </Button>
          {renderDeleteButton()}
        </>
      );
    }

    if (isScreenshotKeptLocally(screenshot)) {
      return (
        <>
          <Button disabled={isBusy} onClick={handleUpload}>
            {t("upload")}
          </Button>
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
        </div>

        <div className="screenshot-review-item__meta">
          <p
            className="screenshot-review-item__game"
            title={screenshot.gameTitle}
          >
            {screenshot.gameTitle}
          </p>
          <small className="screenshot-review-item__date">{capturedAt}</small>
        </div>

        <div className="screenshot-review-item__form">
          {isCustomGame && (
            <TextField
              label={t("custom_game_title_label")}
              placeholder={t("custom_game_default_title")}
              hint={t("custom_game_title_hint")}
              maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
              value={draft.customGameTitle}
              disabled={isFormDisabled}
              onChange={(event) =>
                onDraftChange({ ...draft, customGameTitle: event.target.value })
              }
              theme="dark"
            />
          )}

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
