import { useRef, useState } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import {
  RichTextLimit,
  measureRichTextDocHtml,
  measureRichTextDocText,
  pasteWithinRichTextLimit,
} from "./rich-text-limit";

export const RICH_TEXT_EXTENSIONS = [StarterKit.configure({ link: false })];

export const isRichTextEditorAvailable = (
  editor: Editor | null | undefined
): editor is Editor => Boolean(editor && !editor.isDestroyed);

export const clearRichTextEditorIfUnchanged = (
  editor: Editor | null | undefined,
  sentHtml: string
) => {
  if (isRichTextEditorAvailable(editor) && editor.getHTML() === sentHtml) {
    editor.commands.clearContent(true);
  }
};

interface SubmitRichTextEditorOptions {
  clearOnSuccess?: boolean;
}

export const submitRichTextEditor = async (
  editor: Editor | null | undefined,
  send: (html: string) => Promise<boolean>,
  { clearOnSuccess = false }: SubmitRichTextEditorOptions = {}
) => {
  if (!isRichTextEditorAvailable(editor) || !editor.isEditable) return false;

  const sentHtml = editor.getHTML();
  editor.setEditable(false, false);

  try {
    const wasSent = await send(sentHtml);
    if (wasSent && clearOnSuccess) {
      clearRichTextEditorIfUnchanged(editor, sentHtml);
    }
    return wasSent;
  } finally {
    if (isRichTextEditorAvailable(editor)) editor.setEditable(true, false);
  }
};

const getHtmlTextLength = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent?.length ?? 0;
};

interface UseRichTextEditorOptions {
  initialHtml?: string;
  placeholder: string;
  maxLength: number;
  autofocus?: boolean;
  className?: string;
  onSubmitShortcut?: () => void;
  onEscape?: () => void;
  measureText?: (html: string) => number;
}

export function useRichTextEditor({
  initialHtml = "",
  placeholder,
  maxLength,
  autofocus = false,
  className = "rich-text-editor__prose",
  onSubmitShortcut,
  onEscape,
  measureText,
}: UseRichTextEditorOptions) {
  const measure = (html: string) =>
    measureText ? measureText(html) : getHtmlTextLength(html);
  const measureDoc = measureText
    ? measureRichTextDocHtml(measureText)
    : measureRichTextDocText;
  const [charCount, setCharCount] = useState(() =>
    initialHtml ? measure(initialHtml) : 0
  );
  const [htmlLength, setHtmlLength] = useState(initialHtml.length);
  const onSubmitShortcutRef = useRef(onSubmitShortcut);
  onSubmitShortcutRef.current = onSubmitShortcut;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const editor = useEditor({
    extensions: [
      ...RICH_TEXT_EXTENSIONS,
      RichTextLimit.configure({ maxLength, measure: measureDoc }),
    ],
    content: initialHtml,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: {
        class: className,
        "data-placeholder": placeholder,
        "aria-label": placeholder,
        role: "textbox",
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape" && onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
          return true;
        }

        if (
          event.key !== "Enter" ||
          !(event.ctrlKey || event.metaKey) ||
          event.isComposing ||
          !onSubmitShortcutRef.current
        ) {
          return false;
        }

        event.preventDefault();
        onSubmitShortcutRef.current();
        return true;
      },
      handlePaste: (view, _event, slice) =>
        pasteWithinRichTextLimit(view, slice, maxLength, measureDoc),
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const html = updatedEditor.getHTML();
      setCharCount(
        measureText ? measureText(html) : updatedEditor.getText().length
      );
      setHtmlLength(html.length);
    },
  });

  const submit = (
    send: (html: string) => Promise<boolean>,
    options?: SubmitRichTextEditorOptions
  ) => submitRichTextEditor(editor, send, options);

  return {
    editor,
    charCount,
    htmlLength,
    isEmpty: !isRichTextEditorAvailable(editor) || !editor.getText().trim(),
    submit,
  };
}
