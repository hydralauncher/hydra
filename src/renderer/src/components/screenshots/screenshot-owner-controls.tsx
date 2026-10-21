import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, GearIcon } from "@primer/octicons-react";
import cn from "classnames";

import { Button } from "../button/button";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { SelectField } from "../select-field/select-field";
import { TextField } from "../text-field/text-field";
import {
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotDescription,
  sanitizeScreenshotDescriptionInput,
} from "@shared";
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
  onUpdate: (update: ScreenshotUpdateRequest) => Promise<boolean>;
}

export function ScreenshotOwnerControls({
  screenshot,
  isUpdating,
  onUpdate,
}: Readonly<ScreenshotOwnerControlsProps>) {
  const { t } = useTranslation("screenshots");
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [customTitle, setCustomTitle] = useState(screenshot.gameTitle ?? "");
  const [description, setDescription] = useState(screenshot.description ?? "");

  useEffect(() => {
    setCustomTitle(screenshot.gameTitle ?? "");
  }, [screenshot.id, screenshot.gameTitle]);

  useEffect(() => {
    setDescription(screenshot.description ?? "");
  }, [screenshot.id, screenshot.description]);

  const normalizedDescription = normalizeScreenshotDescription(description);
  const isDescriptionChanged =
    normalizedDescription !== (screenshot.description ?? null);

  const handleDescriptionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDescriptionChanged || isUpdating) return;

    void onUpdate({ description: normalizedDescription });
  };

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
      className={cn("screenshot-lightbox__owner", {
        "screenshot-lightbox__owner--expanded": isExpanded,
      })}
    >
      <button
        type="button"
        className="screenshot-lightbox__owner-toggle"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <GearIcon size={16} />
        <span>{t("screenshot_settings")}</span>
        <ChevronDownIcon
          size={16}
          className="screenshot-lightbox__owner-chevron"
        />
      </button>

      {isExpanded ? (
        <div id={contentId} className="screenshot-lightbox__owner-content">
          <form
            className="screenshot-lightbox__description-form"
            onSubmit={handleDescriptionSubmit}
          >
            <TextField
              label={t("description")}
              placeholder={t("add_description")}
              value={description}
              maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
              disabled={isUpdating}
              hint={`${description.length}/${SCREENSHOT_DESCRIPTION_MAX_LENGTH}`}
              onChange={(event) =>
                setDescription(
                  sanitizeScreenshotDescriptionInput(event.target.value)
                )
              }
              rightContent={
                <Button
                  type="submit"
                  theme="outline"
                  disabled={!isDescriptionChanged || isUpdating}
                >
                  {t("save")}
                </Button>
              }
            />
          </form>

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
            onChange={(event) =>
              void onUpdate({ isSpoiler: event.target.checked })
            }
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
        </div>
      ) : null}
    </section>
  );
}
