import { useTranslation } from "react-i18next";

import { escapeHtmlText } from "@shared";
import {
  Button,
  RichTextEditorField,
  useRichTextEditor,
} from "@renderer/components";

import "./review-replies.scss";

const MAX_REPLY_CHARS = 1000;

interface ReviewReplyComposerProps {
  prefill?: string;
  submitting: boolean;
  onSubmit: (answerHtml: string) => void;
  onCancel: () => void;
}

export function ReviewReplyComposer({
  prefill,
  submitting,
  onSubmit,
  onCancel,
}: Readonly<ReviewReplyComposerProps>) {
  const { t } = useTranslation("game_details");
  const { editor, charCount, isEmpty, getHtml } = useRichTextEditor({
    initialHtml: prefill ? `<p>${escapeHtmlText(prefill)}</p>` : "",
    placeholder: t("write_reply_placeholder"),
    maxLength: MAX_REPLY_CHARS,
    autofocus: true,
    className: "game-details__review-editor",
  });

  const handleSubmit = () => {
    onSubmit(getHtml());
  };

  return (
    <div className="game-details__reply-composer">
      <RichTextEditorField
        editor={editor}
        charCount={charCount}
        maxLength={MAX_REPLY_CHARS}
        inputClassName="game-details__reply-input"
      />

      <div className="game-details__reply-composer-actions">
        <Button theme="outline" onClick={onCancel} disabled={submitting}>
          {t("cancel")}
        </Button>
        <Button
          theme="primary"
          onClick={handleSubmit}
          disabled={isEmpty || submitting || charCount > MAX_REPLY_CHARS}
        >
          {submitting ? t("posting_reply") : t("post_reply")}
        </Button>
      </div>
    </div>
  );
}
