import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../button/button";
import { RichTextEditorField } from "../rich-text-editor/rich-text-editor";
import { useRichTextEditor } from "../rich-text-editor/use-rich-text-editor";
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
  const isDisabledRef = useRef(true);

  const submit = async () => {
    if (isDisabledRef.current) return;

    const wasSubmitted = await onSubmit(getHtml());
    if (wasSubmitted && !onCancel) clear();
  };

  const { editor, charCount, isEmpty, getHtml, clear } = useRichTextEditor({
    initialHtml: initialValue,
    placeholder,
    maxLength: SCREENSHOT_COMMENT_MAX_LENGTH,
    autofocus: focusOnMount,
    className: "screenshot-comments__prose",
    onSubmitShortcut: () => void submit(),
    onEscape: onCancel,
  });

  const isDisabled =
    isEmpty || charCount > SCREENSHOT_COMMENT_MAX_LENGTH || isSubmitting;
  isDisabledRef.current = isDisabled;

  return (
    <div className="screenshot-comments__input">
      <RichTextEditorField
        editor={editor}
        charCount={charCount}
        maxLength={SCREENSHOT_COMMENT_MAX_LENGTH}
        className="screenshot-comments__editor"
        tooltipStrategy="fixed"
      />
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
  );
}
