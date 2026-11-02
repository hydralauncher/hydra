import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditorState, type Editor } from "@tiptap/react";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import "./rich-text-editor.scss";

interface RichTextEditorFieldProps {
  editor: Editor | null;
  charCount: number;
  maxLength: number;
  className?: string;
  inputClassName?: string;
  tooltipStrategy?: "absolute" | "fixed";
}

export function RichTextEditorField({
  editor,
  charCount,
  maxLength,
  className,
  inputClassName,
  tooltipStrategy = "absolute",
}: Readonly<RichTextEditorFieldProps>) {
  const { t } = useTranslation("game_details");
  const tooltipId = useId();
  const activeFormats = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
    }),
  });
  const formats: {
    key: keyof NonNullable<typeof activeFormats>;
    label: string;
    content: ReactNode;
    run: () => void;
  }[] = [
    {
      key: "bold",
      label: t("editor_bold"),
      content: <strong>B</strong>,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: t("editor_italic"),
      content: <em>I</em>,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      label: t("editor_underline"),
      content: <u>U</u>,
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
  ];

  return (
    <div className={cn("rich-text-editor", className)}>
      <div className="rich-text-editor__header">
        <div className="rich-text-editor__toolbar">
          {formats.map((format) => (
            <button
              key={format.key}
              type="button"
              onClick={format.run}
              className={cn("rich-text-editor__button", {
                "is-active": activeFormats?.[format.key],
              })}
              disabled={!editor}
              aria-label={format.label}
              aria-pressed={Boolean(activeFormats?.[format.key])}
              data-tooltip-id={tooltipId}
              data-tooltip-content={format.label}
              data-tooltip-place="top"
            >
              {format.content}
            </button>
          ))}
        </div>
        <div className="rich-text-editor__counter">
          <span className={charCount > maxLength ? "over-limit" : ""}>
            {charCount}/{maxLength}
          </span>
        </div>
      </div>
      <div className={cn("rich-text-editor__input", inputClassName)}>
        <EditorContent editor={editor} />
      </div>
      <Tooltip id={tooltipId} place="top" positionStrategy={tooltipStrategy} />
    </div>
  );
}
