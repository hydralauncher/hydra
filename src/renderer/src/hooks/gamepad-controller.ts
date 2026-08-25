/**
 * GamepadController — singleton com UM único RAF loop.
 * Distribui eventos para subscribers com prioridade.
 * Subscriber retorna `true` para consumir o evento.
 */
import { GAMEPAD_BUTTONS, type GamepadButton } from "./gamepad-constants";

type ButtonHandler = () => boolean | void;

interface Subscriber {
  id: number;
  priority: number;
  handlers: Partial<Record<GamepadButton, ButtonHandler>>;
}

let nextId = 0;
const subscribers: Subscriber[] = [];
let rafId: number | null = null;
const prevPressed = new Set<number>();
const holdTimers = new Map<number, ReturnType<typeof setTimeout>>();
const REPEAT_DELAY = 300;
const REPEAT_RATE = 100;

function getActivePad(): Gamepad | null {
  return Array.from(navigator.getGamepads()).find((p) => p !== null) ?? null;
}

function dispatch(btnKey: GamepadButton): void {
  const sorted = [...subscribers].sort((a, b) => b.priority - a.priority);
  for (const sub of sorted) {
    const handler = sub.handlers[btnKey];
    if (!handler) continue;
    const consumed = handler();
    if (consumed === true) break;
  }
}

function fireIndex(idx: number): void {
  const entry = (
    Object.entries(GAMEPAD_BUTTONS) as [GamepadButton, number][]
  ).find(([, v]) => v === idx);
  if (entry) dispatch(entry[0]);
}

function clearRepeat(idx: number): void {
  const t = holdTimers.get(idx);
  if (t !== undefined) {
    clearTimeout(t);
    holdTimers.delete(idx);
  }
}

function scheduleRepeat(idx: number): void {
  const t = setTimeout(() => {
    const interval = setInterval(() => {
      if (!prevPressed.has(idx)) {
        clearInterval(interval);
        return;
      }
      fireIndex(idx);
    }, REPEAT_RATE);
    holdTimers.set(idx, interval as unknown as ReturnType<typeof setTimeout>);
  }, REPEAT_DELAY);
  holdTimers.set(idx, t);
}

function getScrollParent(node: Element | null): Element | null {
  if (!node || node === document.body || node === document.documentElement) {
    return document.scrollingElement || document.body;
  }
  const overflowY = window.getComputedStyle(node).overflowY;
  if (overflowY === "auto" || overflowY === "scroll") {
    if (node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return getScrollParent(node.parentElement);
}

const DEADZONE = 0.2;
const SCROLL_SPEED = 20;

function poll(): void {
  const pad = getActivePad();
  if (pad) {
    if (pad.axes.length >= 4) {
      const rightStickY = pad.axes[3];
      if (Math.abs(rightStickY) > DEADZONE) {
        let target = getScrollParent(document.activeElement);
        if (
          !target ||
          target === document.body ||
          target === document.scrollingElement
        ) {
          target =
            document.querySelector(
              ".app-page__content, .modal__content, .catalogue__content, .library__content, .downloads__content, .profile__scroll-area, .settings__content, main"
            ) ||
            document.scrollingElement ||
            document.body;
        }

        // Apply deadzone subtraction for smoother acceleration from center
        const sign = Math.sign(rightStickY);
        const activeValue = Math.abs(rightStickY) - DEADZONE;
        const normalized = activeValue / (1 - DEADZONE);
        const speed = sign * normalized * SCROLL_SPEED;

        target.scrollBy({ top: speed, behavior: "instant" });
      }
    }

    pad.buttons.forEach((btn, idx) => {
      const was = prevPressed.has(idx);
      if (btn.pressed && !was) {
        prevPressed.add(idx);
        fireIndex(idx);
        scheduleRepeat(idx);
      } else if (!btn.pressed && was) {
        prevPressed.delete(idx);
        clearRepeat(idx);
      }
    });
  } else if (prevPressed.size > 0) {
    prevPressed.clear();
    holdTimers.forEach((t) => clearTimeout(t));
    holdTimers.clear();
  }
  rafId = requestAnimationFrame(poll);
}

function startLoop(): void {
  if (rafId === null) rafId = requestAnimationFrame(poll);
}

function stopLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  holdTimers.forEach((t) => clearTimeout(t));
  holdTimers.clear();
  prevPressed.clear();
}

export function subscribe(
  handlers: Partial<Record<GamepadButton, ButtonHandler>>,
  priority = 0
): number {
  const id = ++nextId;
  subscribers.push({ id, priority, handlers });
  startLoop();
  return id;
}

export function unsubscribe(id: number): void {
  const idx = subscribers.findIndex((s) => s.id === id);
  if (idx !== -1) subscribers.splice(idx, 1);
  if (subscribers.length === 0) stopLoop();
}
