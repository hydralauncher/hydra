import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";

import { Button } from "@renderer/components";

import "./review-replies.scss";

const MAX_REPLY_CHARS = 1000;

interface ReviewReplyComposerProps {
  prefill?: string;
  submitting: boolean;
  onSubmit: (answerHtml: string) => void;
  onCancel: () => void;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function ReviewReplyComposer({
  prefill,
  submitting,
  onSubmit,
  onCancel,
}: Readonly<ReviewReplyComposerProps>) {
  const { t } = useTranslation("game_details");
  const [charCount, setCharCount] = useState(prefill?.length ?? 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Underline,
    ],
    content: prefill ? `<p>${escapeHtml(prefill)}</p>` : "",
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "game-details__review-editor",
        "data-placeholder": t("write_reply_placeholder"),
      },
      handlePaste: (view, event) => {
        const htmlContent = event.clipboardData?.getData("text/html") || "";
        const plainText = event.clipboardData?.getData("text/plain") || "";

        const currentText = view.state.doc.textContent;
        const remainingChars = MAX_REPLY_CHARS - currentText.length;

        if ((htmlContent || plainText) && remainingChars > 0) {
          event.preventDefault();

          if (htmlContent) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = htmlContent;
            const textLength = tempDiv.textContent?.length || 0;

            if (textLength <= remainingChars) {
              return false;
            }
          }

          const truncatedText = plainText.slice(0, remainingChars);
          view.dispatch(view.state.tr.insertText(truncatedText));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setCharCount(text.length);

      if (text.length > MAX_REPLY_CHARS) {
        const truncatedContent = text.slice(0, MAX_REPLY_CHARS);
        editor.commands.setContent(truncatedContent);
        setCharCount(MAX_REPLY_CHARS);
      }
    },
  });

  const handleSubmit = () => {
    const answerHtml = editor?.getHTML() || "";
    onSubmit(answerHtml);
  };

  const isEmpty = !editor?.getText().trim();

  return (
    <div className="game-details__reply-composer">
      <div className="game-details__review-input-container">
        <div className="game-details__review-input-header">
          <div className="game-details__review-editor-toolbar">
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`game-details__editor-button ${editor?.isActive("bold") ? "is-active" : ""}`}
              disabled={!editor}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`game-details__editor-button ${editor?.isActive("italic") ? "is-active" : ""}`}
              disabled={!editor}
            >
              <em>I</em>
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              className={`game-details__editor-button ${editor?.isActive("underline") ? "is-active" : ""}`}
              disabled={!editor}
            >
              <u>U</u>
            </button>
          </div>
          <div className="game-details__review-char-counter">
            <span className={charCount > MAX_REPLY_CHARS ? "over-limit" : ""}>
              {charCount}/{MAX_REPLY_CHARS}
            </span>
          </div>
        </div>
        <div className="game-details__review-input game-details__reply-input">
          <EditorContent editor={editor} />
        </div>
      </div>

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
