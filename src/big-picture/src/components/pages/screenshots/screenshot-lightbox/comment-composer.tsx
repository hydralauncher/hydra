import {
  PaperPlaneRightIcon,
  SignInIcon,
  TextBIcon,
  TextItalicIcon,
  XIcon,
} from "@phosphor-icons/react";
import { EditorContent, type Editor } from "@tiptap/react";
import cn from "classnames";
import { useEffect, useReducer, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot, ScreenshotComment } from "@types";
import {
  AuthPage,
  SCREENSHOT_COMMENT_HTML_MAX_LENGTH,
  SCREENSHOT_COMMENT_MAX_LENGTH,
  richTextToPlainText,
} from "@shared";
import { useRichTextEditor } from "@renderer/components/rich-text-editor/use-rich-text-editor";

import { Button, FocusItem, HorizontalFocusGroup } from "../../../common";
import { useVirtualKeyboardStore } from "../../../../stores";
import type { FocusOverrideTarget } from "../../../../services";
import type { ScreenshotCommentsPanelFocusIds } from "./comment-focus-ids";

const measureCommentText = (html: string) => richTextToPlainText(html).length;

function useEditorRerender(editor: Editor | null) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!editor) return;

    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);
}

interface FormatToggleProps {
  focusId: string;
  label: string;
  isActive: boolean;
  disabled: boolean;
  icon: ReactNode;
  onToggle: () => void;
}

function FormatToggle({
  focusId,
  label,
  isActive,
  disabled,
  icon,
  onToggle,
}: Readonly<FormatToggleProps>) {
  return (
    <FocusItem id={focusId} asChild>
      <button
        type="button"
        className={cn("screenshot-comments__format", {
          "screenshot-comments__format--active": isActive,
        })}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isActive}
        title={label}
        onClick={onToggle}
      >
        {icon}
      </button>
    </FocusItem>
  );
}

interface CommentEditorFormProps {
  focusIds: ScreenshotCommentsPanelFocusIds;
  leftTarget: FocusOverrideTarget;
  editingComment: ScreenshotComment | null;
  isSubmitting: boolean;
  onSubmit: (bodyHtml: string) => Promise<boolean>;
  onCancelEdit: () => void;
}

function CommentEditorForm({
  focusIds,
  leftTarget,
  editingComment,
  isSubmitting,
  onSubmit,
  onCancelEdit,
}: Readonly<CommentEditorFormProps>) {
  const { t } = useTranslation("big_picture");
  const isEditing = editingComment !== null;
  const { editor, charCount, htmlLength, getHtml, clear } = useRichTextEditor({
    initialHtml: editingComment?.bodyHtml ?? "",
    placeholder: t("screenshots_comment_placeholder"),
    maxLength: SCREENSHOT_COMMENT_MAX_LENGTH,
    className: "screenshot-comments__prose",
    measureText: measureCommentText,
  });
  useEditorRerender(editor);

  const isTooLong =
    charCount > SCREENSHOT_COMMENT_MAX_LENGTH ||
    htmlLength > SCREENSHOT_COMMENT_HTML_MAX_LENGTH;
  const canSubmit = charCount > 0 && !isTooLong && !isSubmitting;

  const submit = async () => {
    if (!canSubmit) return;

    const wasSubmitted = await onSubmit(getHtml());
    if (wasSubmitted && !isEditing) clear();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const openKeyboard = () => {
    const element = editor?.view.dom;
    if (!element || isSubmitting) return;

    element.focus({ preventScroll: true });
    useVirtualKeyboardStore.getState().openKeyboard?.(element);
  };

  const toggleFormat = (format: "bold" | "italic") => {
    if (!editor) return;

    const chain = editor.chain().focus();
    if (format === "bold") chain.toggleBold().run();
    else chain.toggleItalic().run();
  };

  return (
    <form className="screenshot-comments__composer" onSubmit={handleSubmit}>
      {isEditing ? (
        <span className="screenshot-comments__editing-label">
          {t("screenshots_comment_editing")}
        </span>
      ) : null}
      <FocusItem
        id={focusIds.input}
        actions={{ primary: openKeyboard }}
        navigationOverrides={{ left: leftTarget, right: { type: "block" } }}
        asChild
      >
        <div
          className={cn("screenshot-comments__editor", {
            "screenshot-comments__editor--disabled": isSubmitting,
          })}
        >
          <EditorContent editor={editor} />
        </div>
      </FocusItem>
      <HorizontalFocusGroup regionId={focusIds.composerRegion} asChild>
        <div className="screenshot-comments__composer-row">
          <FormatToggle
            focusId={focusIds.bold}
            label={t("screenshots_comment_bold")}
            isActive={editor?.isActive("bold") ?? false}
            disabled={isSubmitting}
            icon={<TextBIcon size={18} weight="bold" />}
            onToggle={() => toggleFormat("bold")}
          />
          <FormatToggle
            focusId={focusIds.italic}
            label={t("screenshots_comment_italic")}
            isActive={editor?.isActive("italic") ?? false}
            disabled={isSubmitting}
            icon={<TextItalicIcon size={18} weight="bold" />}
            onToggle={() => toggleFormat("italic")}
          />
          <span
            className={cn("screenshot-comments__counter", {
              "screenshot-comments__counter--over": isTooLong,
            })}
          >
            {charCount}/{SCREENSHOT_COMMENT_MAX_LENGTH}
          </span>
          {isEditing ? (
            <Button
              variant="secondary"
              size="icon"
              focusId={focusIds.cancelEdit}
              disabled={isSubmitting}
              icon={<XIcon size={18} />}
              aria-label={t("screenshots_cancel")}
              title={t("screenshots_cancel")}
              onClick={onCancelEdit}
            >
              {null}
            </Button>
          ) : null}
          <Button
            size="icon"
            focusId={focusIds.send}
            loading={isSubmitting}
            disabled={!canSubmit}
            icon={<PaperPlaneRightIcon size={18} />}
            aria-label={t(
              isEditing ? "screenshots_save" : "screenshots_comment_send"
            )}
            title={t(
              isEditing ? "screenshots_save" : "screenshots_comment_send"
            )}
            focusNavigationOverrides={{ right: { type: "block" } }}
            onClick={() => void submit()}
          >
            {null}
          </Button>
        </div>
      </HorizontalFocusGroup>
    </form>
  );
}

function getComposerNoticeKey(screenshot: ProfileScreenshot, isOwner: boolean) {
  const isAwaitingApproval =
    screenshot.moderationStatus !== undefined &&
    screenshot.moderationStatus !== "APPROVED";

  if (isOwner && isAwaitingApproval) return null;
  if (!screenshot.commentsEnabled) return "screenshots_comments_disabled";

  return "screenshots_comments_not_allowed";
}

export interface CommentComposerProps {
  screenshot: ProfileScreenshot;
  viewerId: string | null;
  isOwner: boolean;
  focusIds: ScreenshotCommentsPanelFocusIds;
  leftTarget: FocusOverrideTarget;
  editingComment: ScreenshotComment | null;
  isSubmitting: boolean;
  onSubmit: (bodyHtml: string) => Promise<boolean>;
  onCancelEdit: () => void;
}

export function CommentComposer({
  screenshot,
  viewerId,
  isOwner,
  focusIds,
  leftTarget,
  editingComment,
  isSubmitting,
  onSubmit,
  onCancelEdit,
}: Readonly<CommentComposerProps>) {
  const { t } = useTranslation("big_picture");

  if (!viewerId) {
    return (
      <div className="screenshot-comments__notice">
        <p>{t("screenshots_comments_sign_in")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.signIn}
          icon={<SignInIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget }}
          onClick={() =>
            void globalThis.window.electron.openAuthWindow(AuthPage.SignIn)
          }
        >
          {t("screenshots_sign_in")}
        </Button>
      </div>
    );
  }

  if (!screenshot.canComment && !editingComment) {
    const noticeKey = getComposerNoticeKey(screenshot, isOwner);
    if (!noticeKey) return null;

    return (
      <div className="screenshot-comments__notice">
        <p>{t(noticeKey)}</p>
      </div>
    );
  }

  return (
    <CommentEditorForm
      key={editingComment?.id ?? "new"}
      focusIds={focusIds}
      leftTarget={leftTarget}
      editingComment={editingComment}
      isSubmitting={isSubmitting}
      onSubmit={onSubmit}
      onCancelEdit={onCancelEdit}
    />
  );
}
