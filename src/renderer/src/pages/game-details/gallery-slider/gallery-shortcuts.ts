const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";
const OPEN_DIALOG_SELECTOR =
  '[role="dialog"]:not([aria-hidden="true"]), dialog[open]';

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;

export const isDialogOpen = () =>
  document.querySelector(OPEN_DIALOG_SELECTOR) !== null;

export const hasShortcutModifier = (event: KeyboardEvent) =>
  event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

export const normalizeShortcutKey = (key: string) =>
  key.length === 1 ? key.toLowerCase() : key;
