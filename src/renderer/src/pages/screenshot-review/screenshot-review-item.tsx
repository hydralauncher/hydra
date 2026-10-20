import { useState } from "react";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot, ProfileVisibility } from "@types";
import {
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
  type ScreenshotReviewVariant,
} from "./screenshot-review-state";

const VISIBILITY_LABEL_KEYS: Record<ProfileVisibility, string> = {
  PUBLIC: "visibility_public",
  FRIENDS: "visibility_friends",
  PRIVATE: "visibility_private",
};

interface ScreenshotReviewItemProps {
  screenshot: LocalScreenshot;
  variant: ScreenshotReviewVariant;
  onRemoved?: (clientId: string) => void;
}

export function ScreenshotReviewItem({
  screenshot,
  variant,
  onRemoved,
}: Readonly<ScreenshotReviewItemProps>) {
  const { t, i18n } = useTranslation("screenshots_capture");

  const [isSpoiler, setIsSpoiler] = useState(screenshot.isSpoiler);
  const [visibility, setVisibility] = useState<ProfileVisibility>(
    screenshot.visibility
  );
  const [customGameTitle, setCustomGameTitle] = useState(
    screenshot.customGameTitle ?? ""
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const isGrid = variant === "grid";
  const isCustomGame = screenshot.shop === "custom";
  const isFormDisabled = isBusy || !isScreenshotEditable(screenshot);
  const buttonSize = isGrid ? "small" : "medium";
  const capturedAt = new Date(screenshot.capturedAt).toLocaleString(
    i18n.language
  );
  const imageAlt = t("screenshot_alt", {
    game: screenshot.gameTitle,
    date: capturedAt,
  });

  const visibilityOptions = SCREENSHOT_VISIBILITY_OPTIONS.map((option) => ({
    key: option,
    value: option,
    label: t(VISIBILITY_LABEL_KEYS[option]),
  }));

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setIsBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      logger.error(label, error);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpload = () => {
    const trimmedTitle = customGameTitle.trim();
    void runAction(
      () =>
        window.electron.uploadLocalScreenshot(screenshot.clientId, {
          isSpoiler,
          visibility,
          customGameTitle: isCustomGame && trimmedTitle ? trimmedTitle : null,
        }),
      "Failed to upload the screenshot"
    );
  };

  const handleSkip = async () => {
    const skipped = await runAction(
      () => window.electron.skipLocalScreenshot(screenshot.clientId),
      "Failed to skip the screenshot"
    );
    if (skipped) onRemoved?.(screenshot.clientId);
  };

  const handleDelete = async () => {
    setIsDeleteModalVisible(false);
    const deleted = await runAction(
      () => window.electron.deleteLocalScreenshot(screenshot.clientId),
      "Failed to delete the screenshot"
    );
    if (deleted) onRemoved?.(screenshot.clientId);
  };

  const handleVisibilityChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const nextVisibility = SCREENSHOT_VISIBILITY_OPTIONS.find(
      (option) => option === event.target.value
    );
    if (nextVisibility) setVisibility(nextVisibility);
  };

  const renderActions = () => {
    if (isScreenshotAwaitingReview(screenshot)) {
      return (
        <>
          <Button size={buttonSize} disabled={isBusy} onClick={handleUpload}>
            {t("upload")}
          </Button>
          <Button
            size={buttonSize}
            theme="outline"
            disabled={isBusy}
            onClick={handleSkip}
          >
            {t("skip")}
          </Button>
          <Button
            size={buttonSize}
            theme="danger"
            disabled={isBusy}
            onClick={() => setIsDeleteModalVisible(true)}
          >
            {t("delete")}
          </Button>
        </>
      );
    }

    if (screenshot.state === "failed") {
      return (
        <>
          <Button size={buttonSize} disabled={isBusy} onClick={handleUpload}>
            {t("retry")}
          </Button>
          <Button
            size={buttonSize}
            theme="danger"
            disabled={isBusy}
            onClick={() => setIsDeleteModalVisible(true)}
          >
            {t("delete")}
          </Button>
          {!isGrid && (
            <Button theme="outline" onClick={() => window.close()}>
              {t("close")}
            </Button>
          )}
        </>
      );
    }

    if (screenshot.state === "uploaded" && !isGrid) {
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
      className={cn(
        "screenshot-review-item",
        `screenshot-review-item--${variant}`
      )}
    >
      <div className="screenshot-review-item__body">
        <div className="screenshot-review-item__preview">
          <img
            src={getLocalImageSource(screenshot.path)}
            alt={imageAlt}
            className="screenshot-review-item__image"
            loading={isGrid ? "lazy" : "eager"}
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
              hint={isGrid ? undefined : t("custom_game_title_hint")}
              maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
              value={customGameTitle}
              disabled={isFormDisabled}
              onChange={(event) => setCustomGameTitle(event.target.value)}
              theme="dark"
            />
          )}

          <div className="screenshot-review-item__checkbox">
            <CheckboxField
              label={t("spoiler_label")}
              checked={isSpoiler}
              disabled={isFormDisabled}
              onChange={(event) => setIsSpoiler(event.target.checked)}
            />
            {!isGrid && (
              <small className="screenshot-review-item__hint">
                {t("spoiler_hint")}
              </small>
            )}
          </div>

          <SelectField
            label={t("visibility_label")}
            value={visibility}
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
