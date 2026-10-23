import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../button/button";
import { RichTextEditorField } from "../rich-text-editor/rich-text-editor";
import { useRichTextEditor } from "../rich-text-editor/use-rich-text-editor";
import {
  SCREENSHOT_COMMENT_HTML_MAX_LENGTH,
  SCREENSHOT_COMMENT_MAX_LENGTH,
  richTextToPlainText,
} from "@shared";

const measureCommentText = (html: string) => richTextToPlainText(html).length;

interface ScreenshotCommentInputProps {
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  isSubmitting?: boolean;
  focusOnMount?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}

export function ScreenshotCommentInput({
  initialValue = "",
  placeholder,
  submitLabel,
  isSubmitting = false,
  focusOnMount = false,
  onSubmit,
  onCancel,
}: Readonly<ScreenshotCommentInputProps>) {
  const { t } = useTranslation("screenshots");
  const isDisabledRef = useRef(true);

  const submit = async () => {
    if (isDisabledRef.current) return;

    await submitEditor(onSubmit, { clearOnSuccess: !onCancel });
  };

  const {
    editor,
    charCount,
    htmlLength,
    submit: submitEditor,
  } = useRichTextEditor({
    initialHtml: initialValue,
    placeholder,
    maxLength: SCREENSHOT_COMMENT_MAX_LENGTH,
    autofocus: focusOnMount,
    className: "screenshot-comments__prose",
    onSubmitShortcut: () => void submit(),
    onEscape: onCancel,
    measureText: measureCommentText,
  });

  const isDisabled =
    charCount === 0 ||
    charCount > SCREENSHOT_COMMENT_MAX_LENGTH ||
    htmlLength > SCREENSHOT_COMMENT_HTML_MAX_LENGTH ||
    isSubmitting;
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
