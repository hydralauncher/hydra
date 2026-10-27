import "./screenshot-upload-form.scss";

import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type {
  LocalScreenshot,
  LocalScreenshotUploadOptions,
  ProfileVisibility,
  ScreenshotQuality,
} from "@types";
import {
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotDescription,
  sanitizeScreenshotDescriptionInput,
  resolveScreenshotUploadQuality,
} from "@shared";

import {
  Checkbox,
  DropdownSelect,
  SegmentedControl,
  type DropdownSelectOption,
  type SegmentedControlOption,
} from "../common";
import type { FocusOverrideTarget } from "../../services";
import { InlineTextField } from "../pages/screenshots/inline-text-field";
import { useBigPictureToast, useUserDetails } from "../../hooks";

export const SCREENSHOT_QUALITY_LABELS: Record<ScreenshotQuality, string> = {
  STANDARD: "720p",
  CLOUD: "1080p",
};

const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

export interface ReviewDraft {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string;
  description: string;
  quality?: ScreenshotQuality;
}

export interface ReviewFieldFocusIds {
  title: string;
  description: string;
  spoiler: string;
  visibility: string;
  quality: string;
}

export const createReviewDraft = (
  record: LocalScreenshot | undefined,
  defaultVisibility: ProfileVisibility
): ReviewDraft => ({
  isSpoiler: record?.isSpoiler ?? false,
  visibility: record?.visibility ?? defaultVisibility,
  customGameTitle: record?.customGameTitle ?? "",
  description: record?.description ?? "",
});

export const toUploadOptions = (
  draft: ReviewDraft,
  isCustomGame: boolean,
  hasCloudSubscription: boolean
): LocalScreenshotUploadOptions => {
  const customGameTitle = draft.customGameTitle.trim();

  return {
    isSpoiler: draft.isSpoiler,
    visibility: draft.visibility,
    customGameTitle: isCustomGame && customGameTitle ? customGameTitle : null,
    description: normalizeScreenshotDescription(draft.description),
    quality: resolveScreenshotUploadQuality(
      draft.quality,
      hasCloudSubscription
    ),
  };
};

interface ReviewFieldsProps {
  clientId: string;
  draft: ReviewDraft;
  isCustomGame: boolean;
  disabled: boolean;
  focusIds: ReviewFieldFocusIds;
  leftTarget: FocusOverrideTarget;
  upTarget?: FocusOverrideTarget;
  downTarget: FocusOverrideTarget;
  onChange: (update: Partial<ReviewDraft>) => void;
}

export function ReviewFields({
  clientId,
  draft,
  isCustomGame,
  disabled,
  focusIds,
  leftTarget,
  upTarget = BLOCK_TARGET,
  downTarget,
  onChange,
}: Readonly<ReviewFieldsProps>) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast } = useBigPictureToast();
  const { hasActiveSubscription } = useUserDetails();
  const uploadQuality = resolveScreenshotUploadQuality(
    draft.quality,
    hasActiveSubscription
  );

  const visibilityOptions = useMemo<
    SegmentedControlOption<ProfileVisibility>[]
  >(
    () => [
      { value: "PUBLIC", label: t("screenshots_visibility_public") },
      { value: "FRIENDS", label: t("screenshots_visibility_friends") },
      { value: "PRIVATE", label: t("screenshots_visibility_private") },
    ],
    [t]
  );

  const qualityOptions = useMemo<DropdownSelectOption<ScreenshotQuality>[]>(
    () => [
      { value: "STANDARD", label: SCREENSHOT_QUALITY_LABELS.STANDARD },
      {
        value: "CLOUD",
        label: (
          <span
            className={cn("screenshot-upload-form__quality-option", {
              "screenshot-upload-form__quality-option--locked":
                !hasActiveSubscription,
            })}
          >
            <span className="screenshot-upload-form__quality-option-label">
              {SCREENSHOT_QUALITY_LABELS.CLOUD}
            </span>
            {hasActiveSubscription ? null : (
              <span className="screenshot-upload-form__cloud-badge">
                Hydra Cloud
              </span>
            )}
          </span>
        ),
      },
    ],
    [hasActiveSubscription]
  );

  const selectQuality = (quality: ScreenshotQuality) => {
    if (quality === "CLOUD" && !hasActiveSubscription) {
      showErrorToast(t("screenshots_review_quality_cloud_title"), {
        message: t("screenshots_review_quality_cloud_message"),
      });
      return;
    }
    onChange({ quality });
  };

  return (
    <>
      {isCustomGame ? (
        <InlineTextField
          key={clientId}
          focusId={focusIds.title}
          navigationOverrides={{
            up: upTarget,
            left: leftTarget,
            right: BLOCK_TARGET,
          }}
          className="screenshot-upload-form__title-field"
          label={t("screenshots_custom_title_label")}
          value={draft.customGameTitle.trim()}
          placeholder={t("screenshots_custom_game")}
          icon={<PencilSimpleIcon size={18} />}
          maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
          allowEmpty
          disabled={disabled}
          onSave={(customGameTitle) => {
            onChange({ customGameTitle });
            return true;
          }}
        />
      ) : null}

      <InlineTextField
        key={`description:${clientId}`}
        focusId={focusIds.description}
        navigationOverrides={{
          up: isCustomGame
            ? { type: "item", itemId: focusIds.title }
            : upTarget,
          left: leftTarget,
          right: BLOCK_TARGET,
        }}
        className="screenshot-upload-form__description-field"
        label={t("screenshots_description_label")}
        value={draft.description}
        placeholder={t("screenshots_add_description")}
        icon={<PlusIcon size={18} weight="bold" />}
        maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
        allowEmpty
        disabled={disabled}
        sanitize={sanitizeScreenshotDescriptionInput}
        onSave={(description) => {
          onChange({ description });
          return true;
        }}
      />

      <Checkbox
        block
        label={t("screenshots_mark_spoiler")}
        secondaryText={t("screenshots_mark_spoiler_description")}
        checked={draft.isSpoiler}
        disabled={disabled}
        focusId={focusIds.spoiler}
        navigationOverrides={{
          up: { type: "item", itemId: focusIds.description },
          down: { type: "item", itemId: focusIds.visibility },
          left: leftTarget,
          right: BLOCK_TARGET,
        }}
        onChange={(isSpoiler) => onChange({ isSpoiler })}
      />

      <SegmentedControl
        label={t("screenshots_visibility_label")}
        value={draft.visibility}
        options={visibilityOptions}
        disabled={disabled}
        focusId={focusIds.visibility}
        navigationOverrides={{
          up: { type: "item", itemId: focusIds.spoiler },
          down: { type: "item", itemId: focusIds.quality },
          left: leftTarget,
        }}
        onValueChange={(visibility) => onChange({ visibility })}
      />

      <DropdownSelect
        label={t("screenshots_review_quality")}
        value={uploadQuality}
        options={qualityOptions}
        disabled={disabled}
        focusId={focusIds.quality}
        focusNavigationOverrides={{
          up: { type: "item", itemId: focusIds.visibility },
          down: downTarget,
          left: leftTarget,
          right: BLOCK_TARGET,
        }}
        className="screenshot-upload-form__quality-select"
        onValueChange={selectQuality}
      />
    </>
  );
}
