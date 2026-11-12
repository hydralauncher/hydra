export const SETTLE_DURATION_MS = 240;
const SETTLE_FROM_ROTATION_DEG = 3;
const SETTLE_FROM_SCALE = 1.05;
const SETTLE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface LibraryDragOverlay {
  move: (input: PointerPosition) => void;
  getRect: () => DOMRect;
  remove: () => void;
}

export const createLibraryDragOverlay = (
  source: HTMLElement,
  input: PointerPosition
): LibraryDragOverlay => {
  const sourceRect = source.getBoundingClientRect();
  const offsetX = input.clientX - sourceRect.left;
  const offsetY = input.clientY - sourceRect.top;

  const overlay = document.createElement("div");
  overlay.className = "library-sortable-game__overlay";
  overlay.style.width = `${sourceRect.width}px`;
  overlay.style.height = `${sourceRect.height}px`;

  const card = document.createElement("div");
  card.className = "library-sortable-game__overlay-card";
  const clone = source.firstElementChild?.cloneNode(true);
  if (clone) card.appendChild(clone);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let position = input;
  let frame = 0;

  const applyPosition = () => {
    frame = 0;
    overlay.style.transform = `translate3d(${position.clientX - offsetX}px, ${position.clientY - offsetY}px, 0)`;
  };

  applyPosition();

  return {
    move: (next) => {
      position = next;
      if (!frame) frame = requestAnimationFrame(applyPosition);
    },
    getRect: () => overlay.getBoundingClientRect(),
    remove: () => {
      cancelAnimationFrame(frame);
      overlay.remove();
    },
  };
};

export const settleLibraryCard = (element: HTMLElement, fromRect: DOMRect) => {
  const card = element.firstElementChild;
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const deltaX = fromRect.left - rect.left;
  const deltaY = fromRect.top - rect.top;

  card.animate(
    [
      {
        opacity: 1,
        filter: "none",
        transform: `translate(${deltaX}px, ${deltaY}px) rotate(${SETTLE_FROM_ROTATION_DEG}deg) scale(${SETTLE_FROM_SCALE})`,
      },
      { opacity: 1, filter: "none", transform: "none" },
    ],
    { duration: SETTLE_DURATION_MS, easing: SETTLE_EASING }
  );
};
