import {
  PaperPlaneRightIcon,
  SignInIcon,
  TextBIcon,
  TextItalicIcon,
  TextUnderlineIcon,
  XIcon,
} from "@phosphor-icons/react";
import { EditorContent, type Editor } from "@tiptap/react";
import cn from "classnames";
import {
  useEffect,
  useReducer,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot, ScreenshotComment } from "@types";
import {
  AuthPage,
  SCREENSHOT_COMMENT_HTML_MAX_LENGTH,
  SCREENSHOT_COMMENT_MAX_LENGTH,
  richTextToPlainText,
} from "@shared";
import {
  isRichTextEditorAvailable,
  useRichTextEditor,
} from "@renderer/components/rich-text-editor/use-rich-text-editor";

import { Button, FocusItem, HorizontalFocusGroup } from "../../../common";
import { useVirtualKeyboardStore } from "../../../../stores";
import type { FocusOverrideTarget } from "../../../../services";
import { EditingBackAction } from "../inline-text-field";
import {
  COMMENTS_NAVIGATION_ORDER,
  type ScreenshotCommentsPanelFocusIds,
} from "./comment-focus-ids";

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

function useEditorDraftSync(
  editor: Editor | null,
  onDraftChange: ((html: string) => void) | undefined
) {
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    if (!editor) return;

    const syncDraft = () => onDraftChangeRef.current?.(editor.getHTML());
    editor.on("update", syncDraft);
    return () => {
      editor.off("update", syncDraft);
    };
  }, [editor]);
}

interface FormatToggleProps {
  focusId: string;
  label: string;
  isActive: boolean;
  icon: ReactNode;
  onToggle: () => void;
}

function FormatToggle({
  focusId,
  label,
  isActive,
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
  draftBody: string;
  pendingDraft?: string | null;
  onPendingDraftApplied?: () => void;
  onDraftChange?: (html: string) => void;
  onSubmit: (bodyHtml: string) => Promise<boolean>;
  onCancelEdit: () => void;
}

function CommentEditorForm({
  focusIds,
  leftTarget,
  editingComment,
  draftBody,
  pendingDraft = null,
  onPendingDraftApplied,
  onDraftChange,
  onSubmit,
  onCancelEdit,
}: Readonly<CommentEditorFormProps>) {
  const { t } = useTranslation("big_picture");
  const isEditing = editingComment !== null;
  const {
    editor,
    charCount,
    htmlLength,
    submit: submitEditor,
  } = useRichTextEditor({
    initialHtml: editingComment?.bodyHtml ?? draftBody,
    placeholder: t("screenshots_comment_placeholder"),
    maxLength: SCREENSHOT_COMMENT_MAX_LENGTH,
    className: "screenshot-comments__prose",
    measureText: measureCommentText,
  });
  useEditorRerender(editor);
  useEditorDraftSync(editor, onDraftChange);

  const isEditorEmpty =
    isRichTextEditorAvailable(editor) && !editor.getText().trim();

  useEffect(() => {
    if (pendingDraft === null || !isEditorEmpty) return;
    if (!isRichTextEditorAvailable(editor)) return;

    editor.commands.setContent(pendingDraft, { emitUpdate: true });
    onPendingDraftApplied?.();
  }, [editor, isEditorEmpty, onPendingDraftApplied, pendingDraft]);

  const isTooLong =
    charCount > SCREENSHOT_COMMENT_MAX_LENGTH ||
    htmlLength > SCREENSHOT_COMMENT_HTML_MAX_LENGTH;
  const canSubmit = charCount > 0 && !isTooLong;

  const submit = async () => {
    if (!canSubmit || !isRichTextEditorAvailable(editor)) return;

    const keyboard = useVirtualKeyboardStore.getState();
    if (keyboard.target === editor.view.dom)
      keyboard.closeKeyboard?.({ restoreFocus: false });

    await submitEditor(onSubmit, { clearOnSuccess: !isEditing });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const openKeyboard = () => {
    const element = editor?.view.dom;
    if (!element) return;

    element.focus({ preventScroll: true });
    useVirtualKeyboardStore.getState().openKeyboard?.(element);
  };

  const toggleFormat = (format: "bold" | "italic" | "underline") => {
    if (!editor) return;

    const chain = editor.chain().focus();
    if (format === "bold") chain.toggleBold().run();
    else if (format === "italic") chain.toggleItalic().run();
    else chain.toggleUnderline().run();
  };

  return (
    <form className="screenshot-comments__composer" onSubmit={handleSubmit}>
      {isEditing ? (
        <>
          <EditingBackAction onBack={onCancelEdit} />
          <span className="screenshot-comments__editing-label">
            {t("screenshots_comment_editing")}
          </span>
        </>
      ) : null}
      <FocusItem
        id={focusIds.input}
        navigationOrder={COMMENTS_NAVIGATION_ORDER.composerInput}
        actions={{ primary: openKeyboard }}
        navigationOverrides={{ left: leftTarget, right: { type: "block" } }}
        asChild
      >
        <div className="screenshot-comments__editor">
          <EditorContent editor={editor} />
        </div>
      </FocusItem>
      <HorizontalFocusGroup
        regionId={focusIds.composerRegion}
        navigationOrder={COMMENTS_NAVIGATION_ORDER.composerToolbar}
        asChild
      >
        <div className="screenshot-comments__composer-row">
          <FormatToggle
            focusId={focusIds.bold}
            label={t("screenshots_comment_bold")}
            isActive={editor?.isActive("bold") ?? false}
            icon={<TextBIcon size={18} weight="bold" />}
            onToggle={() => toggleFormat("bold")}
          />
          <FormatToggle
            focusId={focusIds.italic}
            label={t("screenshots_comment_italic")}
            isActive={editor?.isActive("italic") ?? false}
            icon={<TextItalicIcon size={18} weight="bold" />}
            onToggle={() => toggleFormat("italic")}
          />
          <FormatToggle
            focusId={focusIds.underline}
            label={t("screenshots_comment_underline")}
            isActive={editor?.isActive("underline") ?? false}
            icon={<TextUnderlineIcon size={18} weight="bold" />}
            onToggle={() => toggleFormat("underline")}
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
  restoredDraft: string | null;
  onRestoredDraftApplied: () => void;
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
  restoredDraft,
  onRestoredDraftApplied,
  onSubmit,
  onCancelEdit,
}: Readonly<CommentComposerProps>) {
  const { t } = useTranslation("big_picture");
  const newDraftRef = useRef("");
  if (!viewerId) {
    return (
      <div className="screenshot-comments__notice screenshot-comments__notice--sign-in">
        <p>{t("screenshots_comments_sign_in")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.signIn}
          focusNavigationOrder={COMMENTS_NAVIGATION_ORDER.composerInput}
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

  if (editingComment) {
    return (
      <CommentEditorForm
        key={`edit:${editingComment.id}`}
        focusIds={focusIds}
        leftTarget={leftTarget}
        editingComment={editingComment}
        draftBody=""
        onSubmit={onSubmit}
        onCancelEdit={onCancelEdit}
      />
    );
  }

  return (
    <CommentEditorForm
      key="new"
      focusIds={focusIds}
      leftTarget={leftTarget}
      editingComment={null}
      draftBody={newDraftRef.current}
      pendingDraft={restoredDraft}
      onPendingDraftApplied={onRestoredDraftApplied}
      onDraftChange={(html) => {
        newDraftRef.current = html;
      }}
      onSubmit={onSubmit}
      onCancelEdit={onCancelEdit}
    />
  );
}
