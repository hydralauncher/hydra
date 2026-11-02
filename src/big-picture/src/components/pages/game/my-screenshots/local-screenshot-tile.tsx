import { ImageIcon, TrashIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl } from "@shared";

import { FocusItem } from "../../../common";
import type { FocusOverrides } from "../../../../services";

export const isLocalScreenshotUploadInFlight = (screenshot: LocalScreenshot) =>
  screenshot.state === "queued" ||
  screenshot.state === "uploading" ||
  (screenshot.state === "uploaded" &&
    screenshot.moderationStatus !== "BLOCKED");

interface LocalScreenshotTileProps {
  screenshot: LocalScreenshot;
  focusId: string;
  alt: string;
  isBusy: boolean;
  variant: "thumbnail" | "card";
  navigationOverrides?: FocusOverrides;
  onOpen: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

interface TileActionProps {
  button: string;
  label: string;
  icon: ReactNode;
  isDanger?: boolean;
  disabled: boolean;
  onPress: () => void;
}

function TileAction({
  button,
  label,
  icon,
  isDanger = false,
  disabled,
  onPress,
}: Readonly<TileActionProps>) {
  return (
    <button
      type="button"
      className={cn("local-screenshot-tile__action", {
        "local-screenshot-tile__action--danger": isDanger,
      })}
      tabIndex={-1}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onPress();
      }}
    >
      <span className="local-screenshot-tile__button-hint" aria-hidden="true">
        {button}
      </span>
      {icon}
    </button>
  );
}

export function LocalScreenshotTile({
  screenshot,
  focusId,
  alt,
  isBusy,
  variant,
  navigationOverrides,
  onOpen,
  onDelete,
}: Readonly<LocalScreenshotTileProps>) {
  const { t } = useTranslation("big_picture");
  const [hasFailed, setHasFailed] = useState(false);
  const canDelete =
    !isBusy &&
    screenshot.state !== "uploaded" &&
    !isLocalScreenshotUploadInFlight(screenshot);
  const remove = () => {
    if (canDelete) onDelete(screenshot);
  };

  return (
    <FocusItem
      id={focusId}
      actions={{
        primary: () => onOpen(screenshot),
        press: { y: remove },
      }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <div
        className={cn(
          "local-screenshot-tile",
          `local-screenshot-tile--${variant}`
        )}
        data-local-screenshot={screenshot.clientId}
      >
        <button
          type="button"
          className="local-screenshot-tile__media"
          tabIndex={-1}
          aria-label={alt}
          onClick={() => onOpen(screenshot)}
        >
          {hasFailed ? (
            <span className="local-screenshot-tile__placeholder">
              <ImageIcon size={24} />
            </span>
          ) : (
            <img
              className="local-screenshot-tile__image"
              src={toLocalScreenshotUrl(
                screenshot.previewPath ?? screenshot.path
              )}
              alt=""
              draggable={false}
              loading="lazy"
              onError={() => setHasFailed(true)}
            />
          )}
        </button>

        <span className="local-screenshot-tile__actions">
          <TileAction
            button={t("screenshots_gamepad_button_y")}
            label={t("screenshots_review_delete")}
            icon={<TrashIcon size={14} weight="bold" />}
            isDanger
            disabled={!canDelete}
            onPress={remove}
          />
        </span>
      </div>
    </FocusItem>
  );
}
