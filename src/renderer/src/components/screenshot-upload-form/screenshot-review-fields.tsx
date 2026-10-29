import { useTranslation } from "react-i18next";
import type {
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotQuality,
} from "@types";
import {
  resolveScreenshotUploadQuality,
  sanitizeScreenshotDescriptionInput,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_VISIBILITY_OPTIONS,
} from "@shared";
import {
  CheckboxField,
  InlineEditField,
  HydraCloudBadge,
} from "@renderer/components";
import { useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";

import {
  ReviewSegmentedControl,
  type ReviewSegmentedOption,
} from "./review-segmented-control";
import {
  SCREENSHOT_QUALITY_LABELS,
  isScreenshotEditable,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

import "./screenshot-upload-form.scss";

const VISIBILITY_LABEL_KEYS: Record<ProfileVisibility, string> = {
  PUBLIC: "visibility_public",
  FRIENDS: "visibility_friends_short",
  PRIVATE: "visibility_private",
};

interface ScreenshotReviewFieldsProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  isBusy: boolean;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  onDraftCommit?: () => void;
}

export function ScreenshotReviewFields({
  screenshot,
  draft,
  isBusy,
  onDraftChange,
  onDraftCommit,
}: Readonly<ScreenshotReviewFieldsProps>) {
  const { t } = useTranslation("screenshots_capture");
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();

  const isTitleEditable =
    screenshot.shop === "custom" && isScreenshotEditable(screenshot);
  const isFormDisabled = isBusy || !isScreenshotEditable(screenshot);
  const uploadQuality = resolveScreenshotUploadQuality(
    draft.quality,
    hasActiveSubscription
  );

  const visibilityOptions: ReviewSegmentedOption<ProfileVisibility>[] =
    SCREENSHOT_VISIBILITY_OPTIONS.map((option) => ({
      value: option,
      label: t(VISIBILITY_LABEL_KEYS[option]),
    }));
  const qualityOptions: ReviewSegmentedOption<ScreenshotQuality>[] = [
    { value: "STANDARD", label: SCREENSHOT_QUALITY_LABELS.STANDARD },
    {
      value: "CLOUD",
      label: SCREENSHOT_QUALITY_LABELS.CLOUD,
      isLocked: !hasActiveSubscription,
      addon: hasActiveSubscription ? null : <HydraCloudBadge />,
    },
  ];

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

  const handleQualityChange = (quality: ScreenshotQuality) => {
    if (quality === "CLOUD" && !hasActiveSubscription) {
      showHydraCloudModal("achievements");
      return;
    }
    onDraftChange({ ...draft, quality });
  };

  return (
    <>
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

      <ReviewSegmentedControl
        label={t("visibility_label")}
        options={visibilityOptions}
        value={draft.visibility}
        disabled={isFormDisabled}
        onChange={(visibility) => onDraftChange({ ...draft, visibility })}
      />

      <ReviewSegmentedControl
        label={t("upload_quality")}
        options={qualityOptions}
        value={uploadQuality}
        disabled={isFormDisabled}
        onChange={handleQualityChange}
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
    </>
  );
}
