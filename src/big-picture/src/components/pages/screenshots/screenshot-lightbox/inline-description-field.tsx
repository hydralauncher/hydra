import { PlusIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  normalizeScreenshotDescription,
  sanitizeScreenshotDescriptionInput,
} from "@shared";

import { FocusItem } from "../../../common";
import { useNavigation, useNavigationScreenActions } from "../../../../hooks";
import { useVirtualKeyboardStore } from "../../../../stores";
import type { FocusOverrideTarget } from "../../../../services";

function EditingBackAction({ onBack }: Readonly<{ onBack: () => void }>) {
  useNavigationScreenActions({ press: { b: onBack } });
  return null;
}

interface InlineDescriptionFieldProps {
  focusId: string;
  stageTarget: FocusOverrideTarget;
  isSaving: boolean;
  onSave: (description: string) => Promise<boolean>;
}

export function InlineDescriptionField({
  focusId,
  stageTarget,
  isSaving,
  onSave,
}: Readonly<InlineDescriptionFieldProps>) {
  const { t } = useTranslation("big_picture");
  const { setFocus } = useNavigation();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openKeyboard = () => {
    const input = inputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    useVirtualKeyboardStore.getState().openKeyboard?.(input);
  };

  const startEditing = () => {
    setIsEditing(true);
    globalThis.window.requestAnimationFrame(() => {
      setFocus(focusId);
      openKeyboard();
    });
  };

  const stopEditing = () => {
    const keyboard = useVirtualKeyboardStore.getState();
    if (inputRef.current && keyboard.target === inputRef.current)
      keyboard.closeKeyboard?.({ restoreFocus: false });

    setIsEditing(false);
    setValue("");
    globalThis.window.requestAnimationFrame(() => setFocus(focusId));
  };

  const save = async () => {
    const description = normalizeScreenshotDescription(value);
    if (!description) {
      stopEditing();
      return;
    }

    if (await onSave(description)) {
      setIsEditing(false);
      setValue("");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSaving) void save();
  };

  return (
    <FocusItem
      id={focusId}
      navigationOrder={0}
      actions={{ primary: isEditing ? openKeyboard : startEditing }}
      navigationOverrides={{ left: stageTarget }}
      asChild
    >
      <form
        className={cn("inline-description", {
          "inline-description--editing": isEditing,
        })}
        onSubmit={handleSubmit}
      >
        {isEditing ? (
          <>
            <EditingBackAction onBack={stopEditing} />
            <input
              ref={inputRef}
              className="inline-description__input"
              value={value}
              maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
              placeholder={t("screenshots_description_placeholder")}
              aria-label={t("screenshots_add_description")}
              disabled={isSaving}
              onChange={(event) =>
                setValue(sanitizeScreenshotDescriptionInput(event.target.value))
              }
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                stopEditing();
              }}
            />
          </>
        ) : (
          <button
            type="button"
            className="inline-description__prompt"
            tabIndex={-1}
            onClick={startEditing}
          >
            <PlusIcon size={18} weight="bold" />
            {t("screenshots_add_description")}
          </button>
        )}
      </form>
    </FocusItem>
  );
}
