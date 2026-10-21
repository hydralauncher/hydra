import { Extension, getHTMLFromFragment } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const PASTE_FIT_ATTEMPTS = 5;

export type RichTextMeasure = (doc: ProseMirrorNode) => number;

export const measureRichTextDocText: RichTextMeasure = (doc) =>
  doc.textBetween(0, doc.content.size, "\n\n").length;

export const measureRichTextDocHtml =
  (measureHtml: (html: string) => number): RichTextMeasure =>
  (doc) =>
    measureHtml(getHTMLFromFragment(doc.content, doc.type.schema));

interface RichTextLimitOptions {
  maxLength: number;
  measure: RichTextMeasure;
}

export const RichTextLimit = Extension.create<RichTextLimitOptions>({
  name: "richTextLimit",

  addOptions() {
    return {
      maxLength: Number.POSITIVE_INFINITY,
      measure: measureRichTextDocText,
    };
  },

  addProseMirrorPlugins() {
    const { maxLength, measure } = this.options;

    return [
      new Plugin({
        key: new PluginKey("richTextLimit"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          const nextLength = measure(transaction.doc);
          return nextLength <= maxLength || nextLength <= measure(state.doc);
        },
      }),
    ];
  },
});

const getHtmlTextLength = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent?.length ?? 0;
};

export const pasteWithinRichTextLimit = (
  view: EditorView,
  event: ClipboardEvent,
  maxLength: number,
  measure: RichTextMeasure
) => {
  const htmlContent = event.clipboardData?.getData("text/html") ?? "";
  const plainText = event.clipboardData?.getData("text/plain") ?? "";
  const remaining = maxLength - measure(view.state.doc);

  if (!htmlContent && !plainText) return false;
  if (htmlContent && getHtmlTextLength(htmlContent) <= remaining) return false;

  event.preventDefault();
  let text = plainText;

  for (let attempt = 0; attempt < PASTE_FIT_ATTEMPTS && text; attempt += 1) {
    const transaction = view.state.tr.insertText(text);
    const overflow = measure(transaction.doc) - maxLength;
    if (overflow <= 0) {
      view.dispatch(transaction);
      break;
    }
    text = text.slice(0, Math.max(0, text.length - overflow));
  }

  return true;
};
