import { Extension, getHTMLFromFragment } from "@tiptap/react";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

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

const fitsWithin = (
  view: EditorView,
  slice: Slice,
  maxLength: number,
  measure: RichTextMeasure
) => measure(view.state.tr.replaceSelection(slice).doc) <= maxLength;

const sliceUpTo = (slice: Slice, position: number) =>
  Slice.maxOpen(slice.content.cut(0, position));

export const pasteWithinRichTextLimit = (
  view: EditorView,
  slice: Slice,
  maxLength: number,
  measure: RichTextMeasure
) => {
  if (fitsWithin(view, slice, maxLength, measure)) return false;

  let low = 0;
  let high = slice.content.size;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsWithin(view, sliceUpTo(slice, middle), maxLength, measure)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  if (low > 0) {
    view.dispatch(
      view.state.tr.replaceSelection(sliceUpTo(slice, low)).scrollIntoView()
    );
  }

  return true;
};
