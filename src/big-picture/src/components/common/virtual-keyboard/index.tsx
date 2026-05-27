import "./styles.scss";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../button";
import { GridFocusGroup } from "../grid-focus-group";
import { NavigationLayer } from "../navigation-layer";
import { Typography } from "../typography";
import { FocusRegionContext } from "../../context";
import { IS_BROWSER } from "../../../constants";
import {
  GAMEPAD_REPEAT_INITIAL_DELAY,
  getAcceleratedGamepadRepeatInterval,
} from "../../../helpers";
import { useGamepad, useNavigationScreenActions } from "../../../hooks";
import { useNavigationStore, useVirtualKeyboardStore } from "../../../stores";
import { GamepadButtonType } from "../../../types";

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

type VirtualKeyboardKey =
  | { type: "character"; label: string; value: string }
  | { type: "shift"; label: string }
  | { type: "backspace"; label: string }
  | { type: "space"; label: string }
  | { type: "clear"; label: string }
  | { type: "enter"; label: string }
  | { type: "cursor-left"; label: string }
  | { type: "cursor-right"; label: string };

type VirtualKeyboardVisualKey = {
  type: "visual";
  label: string;
};

type VirtualKeyboardLayoutKey = (
  | VirtualKeyboardKey
  | VirtualKeyboardVisualKey
) & {
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
};

const VIRTUAL_KEYBOARD_LAYER_ID = "big-picture-virtual-keyboard-layer";
const VIRTUAL_KEYBOARD_REGION_ID = "big-picture-virtual-keyboard";
const VIRTUAL_KEYBOARD_FIRST_KEY_ID = "big-picture-virtual-keyboard-key-1";
const VIRTUAL_KEYBOARD_COLUMNS = 11;
const TEXTUAL_INPUT_TYPES = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);
const KEY_LAYOUT: VirtualKeyboardLayoutKey[] = [
  ..."1234567890".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 1,
    column: index + 1,
  })),
  { type: "backspace", label: "⌫", row: 1, column: 11 },
  ..."qwertyuiop".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 2,
    column: index + 1,
  })),
  { type: "clear", label: "Clear", row: 2, column: 11 },
  ..."asdfghjkl/".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 3,
    column: index + 1,
  })),
  { type: "enter", label: "Enter", row: 3, column: 11, rowSpan: 2 },
  { type: "shift", label: "Shift", row: 4, column: 1 },
  ..."zxcvbnm,.".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 4,
    column: index + 2,
  })),
  { type: "visual", label: "123#", row: 5, column: 1, columnSpan: 2 },
  { type: "space", label: "Space", row: 5, column: 3, columnSpan: 7 },
  { type: "cursor-left", label: "←", row: 5, column: 10 },
  { type: "cursor-right", label: "→", row: 5, column: 11 },
];

function getKeyId(key: VirtualKeyboardKey) {
  if (key.type === "character") {
    return `big-picture-virtual-keyboard-key-${key.value}`;
  }

  return `big-picture-virtual-keyboard-key-${key.type}`;
}

function getKeyStyle(key: VirtualKeyboardLayoutKey) {
  return {
    "--virtual-keyboard-key-column": key.column,
    "--virtual-keyboard-key-row": key.row,
    "--virtual-keyboard-key-column-span": key.columnSpan ?? 1,
    "--virtual-keyboard-key-row-span": key.rowSpan ?? 1,
  } as CSSProperties;
}

function isTextualInput(element: HTMLInputElement) {
  return TEXTUAL_INPUT_TYPES.has(element.type.toLowerCase());
}

function isEditableTarget(element: Element | null): element is EditableTarget {
  if (!(element instanceof HTMLElement)) return false;

  if (element instanceof HTMLInputElement) {
    return (
      isTextualInput(element) &&
      !element.disabled &&
      !element.readOnly &&
      element.type !== "hidden"
    );
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }

  return element.isContentEditable;
}

function focusEditableTarget(target: EditableTarget) {
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

function getInputSelection(target: HTMLInputElement | HTMLTextAreaElement) {
  try {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;

    return { start, end };
  } catch {
    return { start: target.value.length, end: target.value.length };
  }
}

function setNativeValue(
  target: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(target, value);
}

function dispatchInputEvent(target: EditableTarget, data: string | null) {
  try {
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data,
        inputType: data === null ? "deleteContentBackward" : "insertText",
      })
    );
  } catch {
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function setInputSelection(
  target: HTMLInputElement | HTMLTextAreaElement,
  position: number
) {
  try {
    target.setSelectionRange(position, position);
  } catch {
    // Some input types, like number, do not expose a text selection API.
  }
}

function restoreInputSelectionAfterRender(
  target: HTMLInputElement | HTMLTextAreaElement,
  position: number
) {
  globalThis.requestAnimationFrame(() => {
    if (!globalThis.document.contains(target)) return;

    focusEditableTarget(target);
    setInputSelection(target, position);
  });
}

function replaceInputSelection(
  target: HTMLInputElement | HTMLTextAreaElement,
  text: string
) {
  const value = target.value;
  const { start, end } = getInputSelection(target);
  const selectionLength = end - start;
  const maxLength = target.maxLength;
  const allowedText =
    maxLength >= 0
      ? text.slice(0, Math.max(0, maxLength - (value.length - selectionLength)))
      : text;

  if (!allowedText) return getInputSelection(target).start;

  const nextValue = `${value.slice(0, start)}${allowedText}${value.slice(end)}`;
  const nextCursor = start + allowedText.length;

  setNativeValue(target, nextValue);
  setInputSelection(target, nextCursor);
  dispatchInputEvent(target, allowedText);

  return nextCursor;
}

function backspaceInput(target: HTMLInputElement | HTMLTextAreaElement) {
  const value = target.value;
  const { start, end } = getInputSelection(target);

  if (start === 0 && end === 0) return 0;

  const deleteStart = start === end ? Math.max(0, start - 1) : start;
  const nextValue = `${value.slice(0, deleteStart)}${value.slice(end)}`;

  setNativeValue(target, nextValue);
  setInputSelection(target, deleteStart);
  dispatchInputEvent(target, null);

  return deleteStart;
}

function clearInput(target: HTMLInputElement | HTMLTextAreaElement) {
  setNativeValue(target, "");
  setInputSelection(target, 0);
  dispatchInputEvent(target, null);

  return 0;
}

function moveInputCursor(
  target: HTMLInputElement | HTMLTextAreaElement,
  direction: "left" | "right"
) {
  const value = target.value;
  const { start, end } = getInputSelection(target);
  const nextPosition =
    direction === "left"
      ? start === end
        ? Math.max(0, start - 1)
        : start
      : start === end
        ? Math.min(value.length, end + 1)
        : end;

  setInputSelection(target, nextPosition);

  return nextPosition;
}

function submitSingleLineInput(target: HTMLInputElement) {
  if (target.form) {
    target.form.requestSubmit();
  }
}

function insertContentEditableText(target: HTMLElement, text: string) {
  target.focus({ preventScroll: true });
  globalThis.document.execCommand("insertText", false, text);
  dispatchInputEvent(target, text);
}

function backspaceContentEditable(target: HTMLElement) {
  target.focus({ preventScroll: true });
  globalThis.document.execCommand("delete", false);
  dispatchInputEvent(target, null);
}

function clearContentEditable(target: HTMLElement) {
  target.textContent = "";
  dispatchInputEvent(target, null);
}

function getTargetLabel(target: EditableTarget | null) {
  if (!target) return "Text input";

  if ("ariaLabel" in target && target.ariaLabel) {
    return target.ariaLabel;
  }

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.placeholder || target.name || "Text input";
  }

  return "Text input";
}

function useAcceleratedHoldAction({
  enabled,
  isPressed,
  onAction,
}: {
  enabled: boolean;
  isPressed: boolean;
  onAction: () => void;
}) {
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    if (!enabled || !isPressed) return;

    let repeatCount = 0;
    let timerId: number | null = null;

    const clearTimer = () => {
      if (timerId === null) return;

      globalThis.window.clearTimeout(timerId);
      timerId = null;
    };

    const scheduleRepeat = (delay: number) => {
      timerId = globalThis.window.setTimeout(() => {
        onActionRef.current();

        const nextDelay = getAcceleratedGamepadRepeatInterval(repeatCount);
        repeatCount += 1;
        scheduleRepeat(nextDelay);
      }, delay);
    };

    onActionRef.current();
    scheduleRepeat(GAMEPAD_REPEAT_INITIAL_DELAY);

    return clearTimer;
  }, [enabled, isPressed]);
}

export function VirtualKeyboardProvider() {
  const [target, setTarget] = useState<EditableTarget | null>(null);
  const [isShiftActive, setIsShiftActive] = useState(false);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const setVirtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.setTarget
  );
  const { isButtonPressed } = useGamepad();
  const suppressedTargetRef = useRef<EditableTarget | null>(null);
  const keyboardRef = useRef<HTMLDivElement | null>(null);
  const isOpen = Boolean(target);
  const portalTarget = IS_BROWSER
    ? (globalThis.document.getElementById("big-picture") ??
      globalThis.document.getElementById("root") ??
      globalThis.document.body)
    : null;

  const closeKeyboard = useCallback(
    (restoreFocus = true) => {
      const currentTarget = target;

      if (restoreFocus && currentTarget) {
        suppressedTargetRef.current = currentTarget;
      }

      setTarget(null);
      setVirtualKeyboardTarget(null);
      setIsShiftActive(false);

      if (restoreFocus && currentTarget) {
        globalThis.requestAnimationFrame(() => {
          if (!globalThis.document.contains(currentTarget)) return;

          focusEditableTarget(currentTarget);
        });
      }
    },
    [setVirtualKeyboardTarget, target]
  );

  const insertText = useCallback(
    (text: string) => {
      if (!target || !globalThis.document.contains(target)) {
        closeKeyboard(false);
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        focusEditableTarget(target);
        const nextCursor = replaceInputSelection(target, text);
        restoreInputSelectionAfterRender(target, nextCursor);
      } else {
        insertContentEditableText(target, text);
      }

      setIsShiftActive(false);
      focusEditableTarget(target);
    },
    [closeKeyboard, target]
  );

  const backspace = useCallback(() => {
    if (!target || !globalThis.document.contains(target)) {
      closeKeyboard(false);
      return;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      focusEditableTarget(target);
      const nextCursor = backspaceInput(target);
      restoreInputSelectionAfterRender(target, nextCursor);
    } else {
      backspaceContentEditable(target);
    }

    focusEditableTarget(target);
  }, [closeKeyboard, target]);

  const clear = useCallback(() => {
    if (!target || !globalThis.document.contains(target)) {
      closeKeyboard(false);
      return;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      focusEditableTarget(target);
      const nextCursor = clearInput(target);
      restoreInputSelectionAfterRender(target, nextCursor);
    } else {
      clearContentEditable(target);
    }

    focusEditableTarget(target);
  }, [closeKeyboard, target]);

  const moveCursor = useCallback(
    (direction: "left" | "right") => {
      if (!target || !globalThis.document.contains(target)) {
        closeKeyboard(false);
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        focusEditableTarget(target);
        const nextCursor = moveInputCursor(target, direction);
        restoreInputSelectionAfterRender(target, nextCursor);
      } else {
        focusEditableTarget(target);
      }

      focusEditableTarget(target);
    },
    [closeKeyboard, target]
  );

  const enter = useCallback(() => {
    if (!target || !globalThis.document.contains(target)) {
      closeKeyboard(false);
      return;
    }

    if (target instanceof HTMLTextAreaElement) {
      focusEditableTarget(target);
      const nextCursor = replaceInputSelection(target, "\n");
      restoreInputSelectionAfterRender(target, nextCursor);
      focusEditableTarget(target);
      return;
    }

    if (target instanceof HTMLInputElement) {
      submitSingleLineInput(target);
      closeKeyboard();
      return;
    }

    insertContentEditableText(target, "\n");
    focusEditableTarget(target);
  }, [closeKeyboard, target]);

  const handleKey = useCallback(
    (key: VirtualKeyboardKey) => {
      if (key.type === "character") {
        insertText(isShiftActive ? key.value.toUpperCase() : key.value);
        return;
      }

      if (key.type === "space") {
        insertText(" ");
        return;
      }

      if (key.type === "backspace") {
        backspace();
        return;
      }

      if (key.type === "clear") {
        clear();
        return;
      }

      if (key.type === "enter") {
        enter();
        return;
      }

      if (key.type === "cursor-left") {
        moveCursor("left");
        return;
      }

      if (key.type === "cursor-right") {
        moveCursor("right");
        return;
      }

      if (key.type === "shift") {
        setIsShiftActive((current) => !current);
      }
    },
    [backspace, clear, enter, insertText, isShiftActive, moveCursor]
  );

  useNavigationScreenActions(
    isOpen
      ? {
          press: {
            b: () => closeKeyboard(),
            y: () => setIsShiftActive((current) => !current),
          },
        }
      : {}
  );

  useAcceleratedHoldAction({
    enabled: isOpen,
    isPressed: isButtonPressed(GamepadButtonType.BUTTON_X),
    onAction: backspace,
  });
  useAcceleratedHoldAction({
    enabled: isOpen,
    isPressed: isButtonPressed(GamepadButtonType.LEFT_BUMPER),
    onAction: () => moveCursor("left"),
  });
  useAcceleratedHoldAction({
    enabled: isOpen,
    isPressed: isButtonPressed(GamepadButtonType.RIGHT_BUMPER),
    onAction: () => moveCursor("right"),
  });

  useEffect(() => {
    if (!IS_BROWSER) return;

    const handleFocusIn = (event: FocusEvent) => {
      const nextTarget = event.target instanceof Element ? event.target : null;

      if (!isEditableTarget(nextTarget)) return;

      if (suppressedTargetRef.current === nextTarget) return;

      setVirtualKeyboardTarget(nextTarget);
      setTarget(nextTarget);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (suppressedTargetRef.current === event.target) {
        suppressedTargetRef.current = null;
      }
    };

    globalThis.window.addEventListener("focusin", handleFocusIn);
    globalThis.window.addEventListener("focusout", handleFocusOut);

    return () => {
      globalThis.window.removeEventListener("focusin", handleFocusIn);
      globalThis.window.removeEventListener("focusout", handleFocusOut);
    };
  }, [setVirtualKeyboardTarget]);

  useEffect(() => {
    return () => {
      setVirtualKeyboardTarget(null);
    };
  }, [setVirtualKeyboardTarget]);

  useEffect(() => {
    if (!target) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeKeyboard();
      }
    };

    globalThis.window.addEventListener("keydown", handleKeyDown, true);

    const intervalId = globalThis.window.setInterval(() => {
      if (!globalThis.document.contains(target) || !isEditableTarget(target)) {
        closeKeyboard(false);
      }
    }, 500);

    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown, true);
      globalThis.window.clearInterval(intervalId);
    };
  }, [closeKeyboard, target]);

  useEffect(() => {
    if (
      !target ||
      !currentFocusId?.startsWith("big-picture-virtual-keyboard-key-")
    ) {
      return;
    }

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      if (!globalThis.document.contains(target)) return;

      focusEditableTarget(target);
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [currentFocusId, target]);

  const targetLabel = useMemo(() => getTargetLabel(target), [target]);

  if (!portalTarget) return null;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <AnimatePresence>
        {target ? (
          <NavigationLayer
            layerId={VIRTUAL_KEYBOARD_LAYER_ID}
            rootRegionId={VIRTUAL_KEYBOARD_REGION_ID}
            initialFocusId={VIRTUAL_KEYBOARD_FIRST_KEY_ID}
          >
            <motion.aside
              ref={keyboardRef}
              className="virtual-keyboard"
              role="dialog"
              aria-label="Virtual keyboard"
              initial={{ opacity: 0, x: "-50%", y: 32, scale: 0.98 }}
              animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
              exit={{ opacity: 0, x: "-50%", y: 24, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Typography
                variant="label"
                className="virtual-keyboard__target-label"
              >
                Typing in {targetLabel}
              </Typography>

              <GridFocusGroup
                regionId={VIRTUAL_KEYBOARD_REGION_ID}
                className="virtual-keyboard__keys"
                style={
                  {
                    "--virtual-keyboard-columns": VIRTUAL_KEYBOARD_COLUMNS,
                  } as CSSProperties
                }
              >
                {KEY_LAYOUT.map((key) => {
                  const keyStyle = getKeyStyle(key);

                  if (key.type === "visual") {
                    return (
                      <span
                        key={`virtual-keyboard-visual-${key.label}`}
                        className="virtual-keyboard__key virtual-keyboard__key--visual"
                        style={keyStyle}
                        aria-hidden="true"
                      >
                        {key.label}
                      </span>
                    );
                  }

                  const keyId = getKeyId(key);
                  const label =
                    key.type === "character" && isShiftActive
                      ? key.label.toUpperCase()
                      : key.label;

                  return (
                    <Button
                      key={keyId}
                      type="button"
                      variant="secondary"
                      className="virtual-keyboard__key"
                      focusId={keyId}
                      style={keyStyle}
                      data-key-type={key.type}
                      data-active={
                        key.type === "shift" && isShiftActive
                          ? "true"
                          : undefined
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleKey(key)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </GridFocusGroup>
              <div className="virtual-keyboard__hint">
                <span>A Select</span>
                <span>B Close</span>
                <span>Hold X Backspace</span>
                <span>Y Shift</span>
                <span>Hold LB/RB Move cursor</span>
              </div>
            </motion.aside>
          </NavigationLayer>
        ) : null}
      </AnimatePresence>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
