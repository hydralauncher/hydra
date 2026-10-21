import { useRef, useState } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";

export const RICH_TEXT_EXTENSIONS = [
  StarterKit.configure({ link: false }),
  Underline,
];

export const isRichTextEditorAvailable = (
  editor: Editor | null | undefined
): editor is Editor => Boolean(editor && !editor.isDestroyed);

export const clearRichTextEditor = (editor: Editor | null | undefined) => {
  if (isRichTextEditorAvailable(editor)) editor.commands.clearContent(true);
};

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
  const [charCount, setCharCount] = useState(() =>
    initialHtml ? measure(initialHtml) : 0
  );
  const [htmlLength, setHtmlLength] = useState(initialHtml.length);
  const onSubmitShortcutRef = useRef(onSubmitShortcut);
  onSubmitShortcutRef.current = onSubmitShortcut;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const editor = useEditor({
    extensions: RICH_TEXT_EXTENSIONS,
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
          event.shiftKey ||
          event.isComposing ||
          !onSubmitShortcutRef.current
        ) {
          return false;
        }

        event.preventDefault();
        onSubmitShortcutRef.current();
        return true;
      },
      handlePaste: (view, event) => {
        const htmlContent = event.clipboardData?.getData("text/html") || "";
        const plainText = event.clipboardData?.getData("text/plain") || "";
        const remainingChars = maxLength - view.state.doc.textContent.length;

        if (!(htmlContent || plainText) || remainingChars <= 0) return false;

        event.preventDefault();

        if (htmlContent && getHtmlTextLength(htmlContent) <= remainingChars) {
          return false;
        }

        view.dispatch(
          view.state.tr.insertText(plainText.slice(0, remainingChars))
        );
        return true;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const text = updatedEditor.getText();

      if (text.length > maxLength) {
        updatedEditor.commands.setContent(text.slice(0, maxLength));
      }

      const html = updatedEditor.getHTML();
      setCharCount(
        measureText ? measureText(html) : updatedEditor.getText().length
      );
      setHtmlLength(html.length);
    },
  });

  const clear = () => {
    clearRichTextEditor(editor);
    setCharCount(0);
    setHtmlLength(0);
  };

  const submit = (
    send: (html: string) => Promise<boolean>,
    options?: SubmitRichTextEditorOptions
  ) => submitRichTextEditor(editor, send, options);

  return {
    editor,
    charCount,
    htmlLength,
    isEmpty: !isRichTextEditorAvailable(editor) || !editor.getText().trim(),
    getHtml: () => (isRichTextEditorAvailable(editor) ? editor.getHTML() : ""),
    clear,
    submit,
  };
}

export type RichTextEditorInstance = Editor | null;
