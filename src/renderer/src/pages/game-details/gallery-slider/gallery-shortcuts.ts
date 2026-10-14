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

let lastPointerPosition: { x: number; y: number } | null = null;
const pointerMoves = new WeakMap<Event, boolean>();

const isAtLastPointerPosition = (event: PointerEvent) =>
  lastPointerPosition?.x === event.screenX &&
  lastPointerPosition?.y === event.screenY;

const trackPointerPosition = (event: PointerEvent) => {
  pointerMoves.set(event, !isAtLastPointerPosition(event));
  lastPointerPosition = { x: event.screenX, y: event.screenY };
};

window.addEventListener("pointermove", trackPointerPosition, {
  capture: true,
  passive: true,
});

export const isPointerActivity = (event: PointerEvent) =>
  event.type === "pointerdown" ||
  (pointerMoves.get(event) ?? !isAtLastPointerPosition(event));
