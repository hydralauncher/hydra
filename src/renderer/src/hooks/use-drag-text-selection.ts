import { useEffect } from "react";

const IGNORED_DRAG_TARGETS = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[contenteditable="true"]',
  '[draggable="true"]',
  '[role="slider"]',
  '[role="separator"]',
].join(", ");

const SELECTABLE_VALUES = new Set(["text", "all", "contain"]);

const isSelectableElement = (element: Element | null) => {
  let current = element;
  while (current) {
    const userSelect = getComputedStyle(current).userSelect;
    if (SELECTABLE_VALUES.has(userSelect)) return true;
    if (userSelect === "none") return false;
    current = current.parentElement;
  }
  return true;
};

const isOnScrollbar = (event: MouseEvent, target: Element) =>
  target.clientWidth > 0 &&
  (event.offsetX >= target.clientWidth || event.offsetY >= target.clientHeight);

const selectableCaretAt = (x: number, y: number) => {
  const position = document.caretPositionFromPoint(x, y);
  const node = position?.offsetNode;
  if (!position || !(node instanceof Text)) return null;
  if (!isSelectableElement(node.parentElement)) return null;
  return { node, offset: position.offset };
};

export function useDragTextSelection() {
  useEffect(() => {
    let tracking = false;
    let anchor: { node: Text; offset: number } | null = null;

    const reset = () => {
      tracking = false;
      anchor = null;
    };

    const handleMouseDown = (event: MouseEvent) => {
      reset();
      const target = event.target;
      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        isSelectableElement(target)
      ) {
        return;
      }
      if (!window.getSelection()?.isCollapsed) {
        window.getSelection()?.removeAllRanges();
      }
      if (
        event.detail > 1 ||
        target.closest(IGNORED_DRAG_TARGETS) ||
        isOnScrollbar(event, target)
      ) {
        return;
      }
      tracking = true;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!tracking) return;
      if ((event.buttons & 1) === 0) {
        reset();
        return;
      }
      const caret = selectableCaretAt(event.clientX, event.clientY);
      if (!caret) return;
      if (!anchor?.node.isConnected) anchor = caret;
      window
        .getSelection()
        ?.setBaseAndExtent(
          anchor.node,
          anchor.offset,
          caret.node,
          caret.offset
        );
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mouseup", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
}
