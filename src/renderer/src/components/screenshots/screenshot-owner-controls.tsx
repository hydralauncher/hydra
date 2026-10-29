import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useFeature } from "@renderer/hooks";
import { Button } from "../button/button";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { SelectField } from "../select-field/select-field";
import { TextField } from "../text-field/text-field";
import {
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  SCREENSHOT_VISIBILITY_OPTIONS,
  buildScreenshotSettingsUpdate,
  readScreenshotSettings,
  sanitizeScreenshotDescriptionInput,
  type ScreenshotSettingsValues,
} from "@shared";
import type {
  ProfileScreenshot,
  ProfileVisibility,
  ScreenshotUpdateRequest,
} from "@types";

interface ScreenshotOwnerControlsProps {
  screenshot: ProfileScreenshot;
  isUpdating: boolean;
  onSave: (update: ScreenshotUpdateRequest) => Promise<boolean>;
  onDone: () => void;
}

export function ScreenshotOwnerControls({
  screenshot,
  isUpdating,
  onSave,
  onDone,
}: Readonly<ScreenshotOwnerControlsProps>) {
  const { t } = useTranslation("screenshots");
  const { isFeatureEnabled, Feature } = useFeature();
  const isCommentsEnabled = isFeatureEnabled(Feature.ScreenshotComments);
  const [values, setValues] = useState<ScreenshotSettingsValues>(() =>
    readScreenshotSettings(screenshot)
  );
  const screenshotRef = useRef(screenshot);
  screenshotRef.current = screenshot;
  const screenshotId = screenshot.id;

  useEffect(() => {
    setValues(readScreenshotSettings(screenshotRef.current));
  }, [screenshotId]);

  const setValue = <Key extends keyof ScreenshotSettingsValues>(
    key: Key,
    value: ScreenshotSettingsValues[Key]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUpdating) return;

    const update = buildScreenshotSettingsUpdate(screenshot, values);
    if (Object.keys(update).length === 0 || (await onSave(update))) onDone();
  };

  return (
    <form
      className="screenshot-manage-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <TextField
        label={t("description")}
        placeholder={t("add_description")}
        value={values.description}
        maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
        disabled={isUpdating}
        hint={`${values.description.length}/${SCREENSHOT_DESCRIPTION_MAX_LENGTH}`}
        onChange={(event) =>
          setValue(
            "description",
            sanitizeScreenshotDescriptionInput(event.target.value)
          )
        }
      />

      {screenshot.descriptionModerationStatus === "BLOCKED" &&
      values.description === (screenshot.description ?? "") ? (
        <p className="screenshot-manage-form__note">
          {t("description_only_visible_to_you")}
        </p>
      ) : null}

      <SelectField
        label={t("visibility")}
        value={values.visibility}
        disabled={isUpdating}
        onChange={(event) =>
          setValue("visibility", event.target.value as ProfileVisibility)
        }
        options={SCREENSHOT_VISIBILITY_OPTIONS.map((visibility) => ({
          key: visibility,
          value: visibility,
          label: t(`visibility_${visibility.toLowerCase()}`),
        }))}
      />

      <CheckboxField
        label={t("mark_as_spoiler")}
        checked={values.isSpoiler}
        disabled={isUpdating}
        onChange={(event) => setValue("isSpoiler", event.target.checked)}
      />

      {isCommentsEnabled ? (
        <CheckboxField
          label={t("allow_comments")}
          checked={values.commentsEnabled}
          disabled={isUpdating}
          onChange={(event) =>
            setValue("commentsEnabled", event.target.checked)
          }
        />
      ) : null}

      {screenshot.isCustomGame ? (
        <TextField
          label={t("custom_game_title")}
          placeholder={t("custom_game")}
          value={values.customGameTitle}
          maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
          disabled={isUpdating}
          onChange={(event) => setValue("customGameTitle", event.target.value)}
        />
      ) : null}

      <div className="screenshot-manage-form__actions">
        <Button theme="outline" onClick={onDone} disabled={isUpdating}>
          {t("cancel")}
        </Button>
        <Button type="submit" theme="primary" disabled={isUpdating}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
