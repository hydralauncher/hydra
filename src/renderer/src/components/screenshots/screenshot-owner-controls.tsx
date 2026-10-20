import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { TrashIcon } from "@primer/octicons-react";

import { Button } from "../button/button";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { SelectField } from "../select-field/select-field";
import { TextField } from "../text-field/text-field";
import { SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH } from "@shared";
import type {
  ProfileScreenshot,
  ProfileVisibility,
  ScreenshotUpdateRequest,
} from "@types";

const VISIBILITY_OPTIONS: ProfileVisibility[] = [
  "PUBLIC",
  "FRIENDS",
  "PRIVATE",
];

interface ScreenshotOwnerControlsProps {
  screenshot: ProfileScreenshot;
  isUpdating: boolean;
  isDeleting: boolean;
  onUpdate: (update: ScreenshotUpdateRequest) => Promise<boolean>;
  onRequestDelete: () => void;
}

export function ScreenshotOwnerControls({
  screenshot,
  isUpdating,
  isDeleting,
  onUpdate,
  onRequestDelete,
}: Readonly<ScreenshotOwnerControlsProps>) {
  const { t } = useTranslation("screenshots");
  const [customTitle, setCustomTitle] = useState(screenshot.gameTitle ?? "");

  useEffect(() => {
    setCustomTitle(screenshot.gameTitle ?? "");
  }, [screenshot.id, screenshot.gameTitle]);

  const trimmedCustomTitle = customTitle.trim();
  const isCustomTitleChanged =
    trimmedCustomTitle !== (screenshot.gameTitle ?? "");

  const handleCustomTitleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCustomTitleChanged || isUpdating) return;

    void onUpdate({ customGameTitle: trimmedCustomTitle || null });
  };

  return (
    <section
      className="screenshot-lightbox__owner"
      aria-label={t("screenshot_settings")}
    >
      <h3 className="screenshot-lightbox__section-title">
        {t("screenshot_settings")}
      </h3>

      <SelectField
        label={t("visibility")}
        value={screenshot.visibility ?? "PUBLIC"}
        disabled={isUpdating}
        onChange={(event) =>
          void onUpdate({
            visibility: event.target.value as ProfileVisibility,
          })
        }
        options={VISIBILITY_OPTIONS.map((visibility) => ({
          key: visibility,
          value: visibility,
          label: t(`visibility_${visibility.toLowerCase()}`),
        }))}
      />

      <CheckboxField
        label={t("mark_as_spoiler")}
        checked={screenshot.isSpoiler}
        disabled={isUpdating}
        onChange={(event) => void onUpdate({ isSpoiler: event.target.checked })}
      />

      <CheckboxField
        label={t("allow_comments")}
        checked={screenshot.commentsEnabled}
        disabled={isUpdating}
        onChange={(event) =>
          void onUpdate({ commentsEnabled: event.target.checked })
        }
      />

      {screenshot.isCustomGame ? (
        <form
          className="screenshot-lightbox__title-form"
          onSubmit={handleCustomTitleSubmit}
        >
          <TextField
            label={t("custom_game_title")}
            placeholder={t("custom_game")}
            value={customTitle}
            maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
            disabled={isUpdating}
            onChange={(event) => setCustomTitle(event.target.value)}
            rightContent={
              <Button
                type="submit"
                theme="outline"
                disabled={!isCustomTitleChanged || isUpdating}
              >
                {t("save")}
              </Button>
            }
          />
        </form>
      ) : null}

      <Button
        theme="danger"
        className="screenshot-lightbox__delete"
        disabled={isDeleting}
        onClick={onRequestDelete}
      >
        <TrashIcon size={16} />
        {t("delete_screenshot")}
      </Button>
    </section>
  );
}
