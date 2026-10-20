import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button } from "../button/button";
import { SCREENSHOT_COMMENT_MAX_LENGTH } from "@shared";

interface ScreenshotCommentInputProps {
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  focusOnMount?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}

export function ScreenshotCommentInput({
  initialValue = "",
  placeholder,
  submitLabel,
  isSubmitting,
  focusOnMount = false,
  onSubmit,
  onCancel,
}: Readonly<ScreenshotCommentInputProps>) {
  const { t } = useTranslation("screenshots");
  const counterId = useId();
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusOnMount) return;

    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [focusOnMount]);
  const length = value.length;
  const isEmpty = value.trim().length === 0;
  const isOverLimit = length > SCREENSHOT_COMMENT_MAX_LENGTH;
  const isDisabled = isEmpty || isOverLimit || isSubmitting;

  const submit = async () => {
    if (isDisabled) return;

    const wasSubmitted = await onSubmit(value);
    if (wasSubmitted && !onCancel) setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="screenshot-comments__input">
      <textarea
        className="screenshot-comments__textarea"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby={counterId}
        maxLength={SCREENSHOT_COMMENT_MAX_LENGTH}
        rows={2}
        disabled={isSubmitting}
        ref={textareaRef}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="screenshot-comments__input-footer">
        <span
          id={counterId}
          className={cn("screenshot-comments__counter", {
            "screenshot-comments__counter--limit":
              length >= SCREENSHOT_COMMENT_MAX_LENGTH,
          })}
        >
          {length}/{SCREENSHOT_COMMENT_MAX_LENGTH}
        </span>
        <div className="screenshot-comments__input-actions">
          {onCancel ? (
            <Button theme="outline" onClick={onCancel} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
          ) : null}
          <Button
            theme="primary"
            onClick={() => void submit()}
            disabled={isDisabled}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
