import "./screenshot-manage-modal.scss";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileScreenshot,
  ProfileVisibility,
  ScreenshotUpdateRequest,
} from "@types";
import {
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotDescription,
  sanitizeScreenshotDescriptionInput,
} from "@shared";

import {
  Button,
  Checkbox,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../common";
import { useScreenshotDialogPresence } from "./screenshot-dialog-presence";

const REGION_ID = "screenshot-manage-modal";
const VISIBILITY_FOCUS_ID = "screenshot-manage-visibility";
const SPOILER_FOCUS_ID = "screenshot-manage-spoiler";
const COMMENTS_FOCUS_ID = "screenshot-manage-comments";
const TITLE_FOCUS_ID = "screenshot-manage-title";
const DESCRIPTION_FOCUS_ID = "screenshot-manage-description";
const CANCEL_FOCUS_ID = "screenshot-manage-cancel";
const SAVE_FOCUS_ID = "screenshot-manage-save";

interface ScreenshotManageModalProps {
  visible: boolean;
  screenshot: ProfileScreenshot;
  isSaving: boolean;
  onClose: () => void;
  onSave: (update: ScreenshotUpdateRequest) => Promise<boolean>;
}

function buildUpdate(
  screenshot: ProfileScreenshot,
  values: {
    visibility: ProfileVisibility;
    isSpoiler: boolean;
    commentsEnabled: boolean;
    customGameTitle: string;
    description: string;
  }
): ScreenshotUpdateRequest {
  const update: ScreenshotUpdateRequest = {};
  const trimmedTitle = values.customGameTitle.trim();
  const currentTitle = screenshot.gameTitle ?? "";

  if (values.visibility !== (screenshot.visibility ?? "PUBLIC"))
    update.visibility = values.visibility;
  if (values.isSpoiler !== screenshot.isSpoiler)
    update.isSpoiler = values.isSpoiler;
  if (values.commentsEnabled !== screenshot.commentsEnabled)
    update.commentsEnabled = values.commentsEnabled;
  if (screenshot.isCustomGame && trimmedTitle !== currentTitle)
    update.customGameTitle = trimmedTitle || null;
  const description = normalizeScreenshotDescription(values.description);
  if (description !== (screenshot.description ?? null))
    update.description = description;

  return update;
}

export function ScreenshotManageModal({
  visible,
  screenshot,
  isSaving,
  onClose,
  onSave,
}: Readonly<ScreenshotManageModalProps>) {
  const { t } = useTranslation("big_picture");
  useScreenshotDialogPresence(visible);
  const [visibility, setVisibility] = useState<ProfileVisibility>("PUBLIC");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [customGameTitle, setCustomGameTitle] = useState("");
  const [description, setDescription] = useState("");
  const screenshotRef = useRef(screenshot);
  screenshotRef.current = screenshot;
  const screenshotId = screenshot.id;

  useEffect(() => {
    if (!visible) return;

    const initial = screenshotRef.current;
    setVisibility(initial.visibility ?? "PUBLIC");
    setIsSpoiler(initial.isSpoiler);
    setCommentsEnabled(initial.commentsEnabled);
    setCustomGameTitle(initial.isCustomGame ? (initial.gameTitle ?? "") : "");
    setDescription(initial.description ?? "");
  }, [screenshotId, visible]);

  const visibilityOptions = useMemo<DropdownSelectOption<ProfileVisibility>[]>(
    () => [
      { value: "PUBLIC", label: t("screenshots_visibility_public") },
      { value: "FRIENDS", label: t("screenshots_visibility_friends") },
      { value: "PRIVATE", label: t("screenshots_visibility_private") },
    ],
    [t]
  );

  const save = async () => {
    const update = buildUpdate(screenshot, {
      visibility,
      isSpoiler,
      commentsEnabled,
      customGameTitle,
      description,
    });

    if (Object.keys(update).length === 0) {
      onClose();
      return;
    }

    if (await onSave(update)) onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("screenshots_manage_title")}
      onClose={onClose}
      closeOnBackdrop={!isSaving}
      closeOnEscape={!isSaving}
      closeOnB={!isSaving}
      initialFocusId={VISIBILITY_FOCUS_ID}
      className="screenshot-manage-modal"
      backdropClassName="screenshot-manage-modal__backdrop"
    >
      <VerticalFocusGroup
        regionId={REGION_ID}
        className="screenshot-manage-modal__form"
      >
        <DropdownSelect
          label={t("screenshots_visibility_label")}
          value={visibility}
          options={visibilityOptions}
          disabled={isSaving}
          focusId={VISIBILITY_FOCUS_ID}
          onValueChange={setVisibility}
        />

        {screenshot.isCustomGame ? (
          <Input
            label={t("screenshots_custom_title_label")}
            placeholder={t("screenshots_custom_game")}
            value={customGameTitle}
            maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
            disabled={isSaving}
            focusId={TITLE_FOCUS_ID}
            onChange={(event) => setCustomGameTitle(event.target.value)}
          />
        ) : null}

        <Input
          label={t("screenshots_description_label")}
          placeholder={t("screenshots_description_placeholder")}
          value={description}
          maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
          hint={`${description.length}/${SCREENSHOT_DESCRIPTION_MAX_LENGTH}`}
          disabled={isSaving}
          focusId={DESCRIPTION_FOCUS_ID}
          onChange={(event) =>
            setDescription(
              sanitizeScreenshotDescriptionInput(event.target.value)
            )
          }
        />

        <Checkbox
          block
          label={t("screenshots_mark_spoiler")}
          secondaryText={t("screenshots_mark_spoiler_description")}
          checked={isSpoiler}
          disabled={isSaving}
          focusId={SPOILER_FOCUS_ID}
          onChange={setIsSpoiler}
        />

        <Checkbox
          block
          label={t("screenshots_allow_comments")}
          checked={commentsEnabled}
          disabled={isSaving}
          focusId={COMMENTS_FOCUS_ID}
          onChange={setCommentsEnabled}
        />

        <HorizontalFocusGroup className="screenshot-manage-modal__actions">
          <Button
            variant="secondary"
            focusId={CANCEL_FOCUS_ID}
            disabled={isSaving}
            onClick={onClose}
          >
            {t("screenshots_cancel")}
          </Button>
          <Button
            focusId={SAVE_FOCUS_ID}
            loading={isSaving}
            onClick={() => void save()}
          >
            {t("screenshots_save")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
