import "./styles.scss";

import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../button";
import { GridFocusGroup } from "../grid-focus-group";
import { NavigationLayer } from "../navigation-layer";
import { FocusRegionContext } from "../../context";
import { IS_BROWSER } from "../../../constants";
import type { FocusDirection, FocusOverrides } from "../../../services";
import {
  GAMEPAD_REPEAT_INITIAL_DELAY,
  getAcceleratedGamepadRepeatInterval,
} from "../../../helpers";
import {
  useGamepad,
  useNavigationActions,
  useNavigationScreenActions,
} from "../../../hooks";
import { useNavigationStore, useVirtualKeyboardStore } from "../../../stores";
import { GamepadButtonType } from "../../../types";

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

type VirtualKeyboardKey =
  | { type: "character"; label: string; value: string }
  | { type: "shift"; label: string }
  | { type: "toggle-layer"; label: string }
  | { type: "backspace"; label: string }
  | { type: "space"; label: string }
  | { type: "clear"; label: string }
  | { type: "enter"; label: string }
  | { type: "cursor-left"; label: string }
  | { type: "cursor-right"; label: string };

type VirtualKeyboardLayer = "alphabetic" | "symbols";
type VirtualKeyboardLayoutMode = "floating" | "avoiding";

type VirtualKeyboardLayoutKey = VirtualKeyboardKey & {
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
};

type VirtualKeyboardKeyPosition = {
  centerColumn: number;
  centerRow: number;
};

const VIRTUAL_KEYBOARD_LAYER_ID = "big-picture-virtual-keyboard-layer";
const VIRTUAL_KEYBOARD_REGION_ID = "big-picture-virtual-keyboard";
const VIRTUAL_KEYBOARD_FIRST_KEY_ID = "big-picture-virtual-keyboard-key-1";
const VIRTUAL_KEYBOARD_BACKSPACE_KEY_ID =
  "big-picture-virtual-keyboard-key-backspace";
const VIRTUAL_KEYBOARD_ENTER_KEY_ID = "big-picture-virtual-keyboard-key-enter";
const VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID =
  "big-picture-virtual-keyboard-key-toggle-layer";
const VIRTUAL_KEYBOARD_DISMISS_EVENT = "big-picture-virtual-keyboard-dismiss";
const VIRTUAL_KEYBOARD_COLUMNS = 11;
const VIRTUAL_KEYBOARD_AVOIDANCE_MARGIN = 24;
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
const ALPHABETIC_KEY_LAYOUT: VirtualKeyboardLayoutKey[] = [
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
  { type: "toggle-layer", label: "123#", row: 5, column: 1, columnSpan: 2 },
  { type: "space", label: "Space", row: 5, column: 3, columnSpan: 7 },
  { type: "cursor-left", label: "←", row: 5, column: 10 },
  { type: "cursor-right", label: "→", row: 5, column: 11 },
];
const SYMBOLS_KEY_LAYOUT: VirtualKeyboardLayoutKey[] = [
  ..."1234567890".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 1,
    column: index + 1,
  })),
  { type: "backspace", label: "⌫", row: 1, column: 11 },
  ..."@#$%&*()-+".split("").map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 2,
    column: index + 1,
  })),
  { type: "clear", label: "Clear", row: 2, column: 11 },
  ...["!", "?", ":", ";", "'", '"', "/", "\\", "_", "="].map(
    (value, index) => ({
      type: "character" as const,
      label: value,
      value,
      row: 3,
      column: index + 1,
    })
  ),
  { type: "enter", label: "Enter", row: 3, column: 11, rowSpan: 2 },
  ...["[", "]", "{", "}", "<", ">", ",", ".", "|", "~"].map((value, index) => ({
    type: "character" as const,
    label: value,
    value,
    row: 4,
    column: index + 1,
  })),
  { type: "toggle-layer", label: "ABC", row: 5, column: 1, columnSpan: 2 },
  { type: "space", label: "Space", row: 5, column: 3, columnSpan: 7 },
  { type: "cursor-left", label: "←", row: 5, column: 10 },
  { type: "cursor-right", label: "→", row: 5, column: 11 },
];

function getKeyId(key: VirtualKeyboardKey) {
  if (key.type === "character") {
    return `big-picture-virtual-keyboard-key-${key.value}`;
  }

  if (key.type === "toggle-layer") {
    return VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID;
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

function getKeyPosition(key: VirtualKeyboardLayoutKey) {
  return {
    centerColumn: key.column + ((key.columnSpan ?? 1) - 1) / 2,
    centerRow: key.row + ((key.rowSpan ?? 1) - 1) / 2,
  };
}

function getKeyShortcutLabel(
  key: VirtualKeyboardKey,
  layer: VirtualKeyboardLayer
) {
  if (key.type === "backspace") return "X";
  if (key.type === "space") return "Y";
  if (key.type === "shift" && layer === "alphabetic") return "L3";
  if (key.type === "toggle-layer") return "R3";
  if (key.type === "enter") return "RT";
  if (key.type === "cursor-left") return "LB";
  if (key.type === "cursor-right") return "RB";

  return null;
}

function findLayoutKeyById(
  layout: VirtualKeyboardLayoutKey[],
  focusId: string | null
) {
  if (!focusId) return null;

  return layout.find((key) => getKeyId(key) === focusId) ?? null;
}

function findClosestLayoutKeyByPosition(
  layout: VirtualKeyboardLayoutKey[],
  position: VirtualKeyboardKeyPosition
) {
  return layout.reduce<VirtualKeyboardLayoutKey | null>((closest, key) => {
    if (!closest) return key;

    const keyPosition = getKeyPosition(key);
    const closestPosition = getKeyPosition(closest);
    const keyDistance =
      (keyPosition.centerColumn - position.centerColumn) ** 2 +
      (keyPosition.centerRow - position.centerRow) ** 2;
    const closestDistance =
      (closestPosition.centerColumn - position.centerColumn) ** 2 +
      (closestPosition.centerRow - position.centerRow) ** 2;

    return keyDistance < closestDistance ? key : closest;
  }, null);
}

function getCoveredIndexes(start: number, span = 1) {
  return Array.from({ length: span }, (_, index) => start + index);
}

function setBoundaryNavigationOverride(
  candidates: Record<
    string,
    Partial<Record<FocusDirection, { score: number; targetId: string }>>
  >,
  sourceId: string,
  direction: FocusDirection,
  targetId: string,
  score: number
) {
  if (sourceId === targetId) return;

  const currentCandidate = candidates[sourceId]?.[direction];

  if (currentCandidate && currentCandidate.score <= score) {
    return;
  }

  candidates[sourceId] = {
    ...candidates[sourceId],
    [direction]: { score, targetId },
  };
}

function getVirtualKeyboardNavigationOverrides(
  layout: VirtualKeyboardLayoutKey[]
): Record<string, FocusOverrides> {
  const entries = layout.map((key) => ({
    key,
    keyId: getKeyId(key),
    position: getKeyPosition(key),
    rows: getCoveredIndexes(key.row, key.rowSpan),
    columns: getCoveredIndexes(key.column, key.columnSpan),
  }));
  const candidates: Record<
    string,
    Partial<Record<FocusDirection, { score: number; targetId: string }>>
  > = {};
  const rows = Array.from(new Set(entries.flatMap((entry) => entry.rows))).sort(
    (a, b) => a - b
  );
  const columns = Array.from(
    new Set(entries.flatMap((entry) => entry.columns))
  ).sort((a, b) => a - b);

  for (const row of rows) {
    const rowEntries = entries
      .filter((entry) => entry.rows.includes(row))
      .sort((left, right) => {
        if (left.key.column !== right.key.column) {
          return left.key.column - right.key.column;
        }

        return left.position.centerColumn - right.position.centerColumn;
      });
    const firstEntry = rowEntries[0];
    const lastEntry = rowEntries[rowEntries.length - 1];

    if (firstEntry && lastEntry) {
      setBoundaryNavigationOverride(
        candidates,
        firstEntry.keyId,
        "left",
        lastEntry.keyId,
        Math.abs(row - firstEntry.position.centerRow)
      );
      setBoundaryNavigationOverride(
        candidates,
        lastEntry.keyId,
        "right",
        firstEntry.keyId,
        Math.abs(row - lastEntry.position.centerRow)
      );
    }
  }

  for (const column of columns) {
    const columnEntries = entries
      .filter((entry) => entry.columns.includes(column))
      .sort((top, bottom) => {
        if (top.key.row !== bottom.key.row) {
          return top.key.row - bottom.key.row;
        }

        return top.position.centerRow - bottom.position.centerRow;
      });
    const firstEntry = columnEntries[0];
    const lastEntry = columnEntries[columnEntries.length - 1];

    if (firstEntry && lastEntry) {
      setBoundaryNavigationOverride(
        candidates,
        firstEntry.keyId,
        "up",
        lastEntry.keyId,
        Math.abs(column - firstEntry.position.centerColumn)
      );
      setBoundaryNavigationOverride(
        candidates,
        lastEntry.keyId,
        "down",
        firstEntry.keyId,
        Math.abs(column - lastEntry.position.centerColumn)
      );
    }
  }

  return Object.fromEntries(
    Object.entries(candidates).map(([keyId, overrides]) => [
      keyId,
      Object.fromEntries(
        Object.entries(overrides).map(([direction, candidate]) => [
          direction,
          {
            type: "item",
            itemId: candidate.targetId,
          },
        ])
      ) as FocusOverrides,
    ])
  );
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

function isScrollableElement(element: HTMLElement) {
  const style = globalThis.getComputedStyle(element);
  const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
  const canScroll = /(auto|scroll|overlay)/.test(overflow);

  return canScroll && element.scrollHeight > element.clientHeight;
}

function getKeyboardAvoidanceScrollContainer(element: HTMLElement) {
  let current = element.parentElement;

  while (current && current !== globalThis.document.body) {
    if (isScrollableElement(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function scrollTargetAboveKeyboard(
  target: EditableTarget,
  keyboardArea: HTMLElement | null
) {
  if (!keyboardArea || !globalThis.document.contains(target)) return;

  const container = getKeyboardAvoidanceScrollContainer(target);

  if (!container) return;

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const keyboardRect = keyboardArea.getBoundingClientRect();
  const safeTop = containerRect.top + VIRTUAL_KEYBOARD_AVOIDANCE_MARGIN;
  const safeBottom =
    Math.min(containerRect.bottom, keyboardRect.top) -
    VIRTUAL_KEYBOARD_AVOIDANCE_MARGIN;

  let deltaY = 0;

  if (targetRect.bottom > safeBottom) {
    deltaY = targetRect.bottom - safeBottom;
  } else if (targetRect.top < safeTop) {
    deltaY = targetRect.top - safeTop;
  }

  if (deltaY === 0) return;

  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = Math.min(Math.max(container.scrollTop + deltaY, 0), maxTop);

  container.scrollTo({
    top: nextTop,
    behavior: "smooth",
  });
}

function isTargetBehindKeyboardArea(
  target: EditableTarget,
  keyboardArea: HTMLElement | null
) {
  if (!keyboardArea || !globalThis.document.contains(target)) return false;

  const targetRect = target.getBoundingClientRect();
  const keyboardRect = keyboardArea.getBoundingClientRect();

  return (
    targetRect.bottom > keyboardRect.top &&
    targetRect.top < keyboardRect.bottom &&
    targetRect.right > keyboardRect.left &&
    targetRect.left < keyboardRect.right
  );
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
  const [layer, setLayer] = useState<VirtualKeyboardLayer>("alphabetic");
  const [layoutMode, setLayoutMode] =
    useState<VirtualKeyboardLayoutMode>("floating");
  const [pulsingKeyId, setPulsingKeyId] = useState<string | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const { setFocus } = useNavigationActions();
  const setVirtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.setTarget
  );
  const setCloseVirtualKeyboard = useVirtualKeyboardStore(
    (state) => state.setCloseKeyboard
  );
  const { isButtonPressed, onButtonPressed, isActiveGamepadEvent } =
    useGamepad();
  const suppressedTargetRef = useRef<EditableTarget | null>(null);
  const activeTargetRef = useRef<EditableTarget | null>(null);
  const shouldRestoreNavigationFocusOnUnmountRef = useRef(true);
  const pulseFrameRef = useRef<number | null>(null);
  const focusOutFrameRef = useRef<number | null>(null);
  const pendingLayerFocusPositionRef =
    useRef<VirtualKeyboardKeyPosition | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const keyboardRef = useRef<HTMLDivElement | null>(null);
  const isOpen = Boolean(target);
  const shouldRestoreNavigationFocusOnUnmount = useCallback(
    () => shouldRestoreNavigationFocusOnUnmountRef.current,
    []
  );

  const closeKeyboard = useCallback(
    (restoreFocus = true) => {
      const currentTarget = target;
      shouldRestoreNavigationFocusOnUnmountRef.current = restoreFocus;

      if (focusOutFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(focusOutFrameRef.current);
        focusOutFrameRef.current = null;
      }

      if (restoreFocus && currentTarget) {
        suppressedTargetRef.current = currentTarget;
      }

      if (!restoreFocus && currentTarget) {
        suppressedTargetRef.current = currentTarget;
        currentTarget.blur();
        globalThis.window.dispatchEvent(
          new CustomEvent(VIRTUAL_KEYBOARD_DISMISS_EVENT, {
            detail: { target: currentTarget },
          })
        );
      }

      setTarget(null);
      activeTargetRef.current = null;
      setVirtualKeyboardTarget(null);
      setIsShiftActive(false);
      setLayer("alphabetic");
      setLayoutMode("floating");
      setPulsingKeyId(null);

      if (pulseFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(pulseFrameRef.current);
        pulseFrameRef.current = null;
      }

      if (restoreFocus && currentTarget) {
        globalThis.requestAnimationFrame(() => {
          if (!globalThis.document.contains(currentTarget)) return;

          focusEditableTarget(currentTarget);
        });
      }
    },
    [setVirtualKeyboardTarget, target]
  );

  useEffect(() => {
    setCloseVirtualKeyboard(({ restoreFocus = true } = {}) => {
      closeKeyboard(restoreFocus);
    });

    return () => {
      setCloseVirtualKeyboard(null);
    };
  }, [closeKeyboard, setCloseVirtualKeyboard]);

  const pulseKey = useCallback((keyId: string) => {
    if (pulseFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(pulseFrameRef.current);
    }

    setPulsingKeyId(null);
    pulseFrameRef.current = globalThis.requestAnimationFrame(() => {
      setPulsingKeyId(keyId);
      pulseFrameRef.current = null;
    });
  }, []);

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

  const hotkeyBackspace = useCallback(() => {
    pulseKey(VIRTUAL_KEYBOARD_BACKSPACE_KEY_ID);
    backspace();
  }, [backspace, pulseKey]);

  const toggleLayer = useCallback(() => {
    const activeLayout =
      layer === "alphabetic" ? ALPHABETIC_KEY_LAYOUT : SYMBOLS_KEY_LAYOUT;
    const activeKey = findLayoutKeyById(activeLayout, currentFocusId);

    pendingLayerFocusPositionRef.current = activeKey
      ? getKeyPosition(activeKey)
      : getKeyPosition(
          findLayoutKeyById(
            activeLayout,
            VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID
          ) ?? activeLayout[0]
        );

    setLayer((currentLayer) => {
      const nextLayer =
        currentLayer === "alphabetic" ? "symbols" : "alphabetic";

      if (nextLayer === "symbols") {
        setIsShiftActive(false);
      }

      return nextLayer;
    });
  }, [currentFocusId, layer]);

  const hotkeyToggleLayer = useCallback(() => {
    pulseKey(VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID);
    toggleLayer();
  }, [pulseKey, toggleLayer]);

  const hotkeySpace = useCallback(() => {
    pulseKey(getKeyId({ type: "space", label: "Space" }));
    insertText(" ");
  }, [insertText, pulseKey]);

  const hotkeyShift = useCallback(() => {
    if (layer !== "alphabetic") return;

    pulseKey(getKeyId({ type: "shift", label: "Shift" }));
    setIsShiftActive((current) => !current);
  }, [layer, pulseKey]);

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

  const hotkeyEnter = useCallback(() => {
    pulseKey(VIRTUAL_KEYBOARD_ENTER_KEY_ID);
    enter();
  }, [enter, pulseKey]);

  const handleKey = useCallback(
    (key: VirtualKeyboardKey) => {
      const keyId = getKeyId(key);

      pulseKey(keyId);

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

      if (key.type === "toggle-layer") {
        toggleLayer();
        return;
      }

      if (key.type === "shift") {
        setIsShiftActive((current) => !current);
      }
    },
    [
      backspace,
      clear,
      enter,
      insertText,
      isShiftActive,
      moveCursor,
      pulseKey,
      toggleLayer,
    ]
  );

  useNavigationScreenActions(
    isOpen
      ? {
          press: {
            b: () => closeKeyboard(false),
            y: hotkeySpace,
          },
        }
      : {}
  );

  useAcceleratedHoldAction({
    enabled: isOpen,
    isPressed: isButtonPressed(GamepadButtonType.BUTTON_X),
    onAction: hotkeyBackspace,
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
    if (!isOpen) return;

    const removeLeftStickPress = onButtonPressed(
      GamepadButtonType.LEFT_STICK_PRESS,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        hotkeyShift();
      }
    );
    const removeRightStickPress = onButtonPressed(
      GamepadButtonType.RIGHT_STICK_PRESS,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        hotkeyToggleLayer();
      }
    );
    const removeRightTrigger = onButtonPressed(
      GamepadButtonType.RIGHT_TRIGGER,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        hotkeyEnter();
      }
    );

    return () => {
      removeLeftStickPress();
      removeRightStickPress();
      removeRightTrigger();
    };
  }, [
    hotkeyEnter,
    hotkeyShift,
    hotkeyToggleLayer,
    isActiveGamepadEvent,
    isOpen,
    onButtonPressed,
  ]);

  useEffect(() => {
    if (!IS_BROWSER) return;

    const handleFocusIn = (event: FocusEvent) => {
      const nextTarget = event.target instanceof Element ? event.target : null;

      if (!isEditableTarget(nextTarget)) return;

      if (suppressedTargetRef.current === nextTarget) return;

      const isNewTarget = activeTargetRef.current !== nextTarget;

      activeTargetRef.current = nextTarget;
      shouldRestoreNavigationFocusOnUnmountRef.current = true;
      setVirtualKeyboardTarget(nextTarget);

      if (isNewTarget) {
        setLayer("alphabetic");
        setIsShiftActive(false);
        setLayoutMode("floating");
      }

      setTarget(nextTarget);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (suppressedTargetRef.current === event.target) {
        suppressedTargetRef.current = null;
        return;
      }

      const blurredTarget =
        event.target instanceof HTMLElement ? event.target : null;

      if (!blurredTarget || activeTargetRef.current !== blurredTarget) {
        return;
      }

      if (focusOutFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(focusOutFrameRef.current);
      }

      focusOutFrameRef.current = globalThis.requestAnimationFrame(() => {
        focusOutFrameRef.current = null;

        if (activeTargetRef.current !== blurredTarget) return;

        const activeElement =
          globalThis.document.activeElement instanceof Element
            ? globalThis.document.activeElement
            : null;

        if (isEditableTarget(activeElement)) return;
        if (activeElement && dockRef.current?.contains(activeElement)) return;

        closeKeyboard(false);
      });
    };

    globalThis.window.addEventListener("focusin", handleFocusIn);
    globalThis.window.addEventListener("focusout", handleFocusOut);

    return () => {
      if (focusOutFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(focusOutFrameRef.current);
        focusOutFrameRef.current = null;
      }

      globalThis.window.removeEventListener("focusin", handleFocusIn);
      globalThis.window.removeEventListener("focusout", handleFocusOut);
    };
  }, [closeKeyboard, setVirtualKeyboardTarget]);

  useEffect(() => {
    if (!IS_BROWSER || !target) return;

    const handlePointerDown = (event: PointerEvent) => {
      const pointerTarget =
        event.target instanceof Element ? event.target : null;

      if (!pointerTarget) return;
      if (target === pointerTarget || target.contains(pointerTarget)) return;
      if (dockRef.current?.contains(pointerTarget)) return;

      if (focusOutFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(focusOutFrameRef.current);
        focusOutFrameRef.current = null;
      }

      closeKeyboard(false);
    };

    globalThis.window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      globalThis.window.removeEventListener(
        "pointerdown",
        handlePointerDown,
        true
      );
    };
  }, [closeKeyboard, target]);

  useEffect(() => {
    return () => {
      if (pulseFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(pulseFrameRef.current);
      }

      if (focusOutFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(focusOutFrameRef.current);
      }

      activeTargetRef.current = null;
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
    if (!target || layoutMode !== "floating") return;

    let secondFrameId: number | null = null;
    const firstFrameId = globalThis.requestAnimationFrame(() => {
      secondFrameId = globalThis.requestAnimationFrame(() => {
        if (isTargetBehindKeyboardArea(target, dockRef.current)) {
          setLayoutMode("avoiding");
        }
      });
    });
    const settledLayoutTimeoutId = globalThis.window.setTimeout(() => {
      if (isTargetBehindKeyboardArea(target, dockRef.current)) {
        setLayoutMode("avoiding");
      }
    }, 200);

    return () => {
      globalThis.cancelAnimationFrame(firstFrameId);

      if (secondFrameId !== null) {
        globalThis.cancelAnimationFrame(secondFrameId);
      }

      globalThis.window.clearTimeout(settledLayoutTimeoutId);
    };
  }, [layoutMode, target]);

  useEffect(() => {
    if (!target || layoutMode !== "avoiding") return;

    let secondFrameId: number | null = null;
    const firstFrameId = globalThis.requestAnimationFrame(() => {
      secondFrameId = globalThis.requestAnimationFrame(() => {
        scrollTargetAboveKeyboard(target, dockRef.current);
      });
    });
    const settledLayoutTimeoutId = globalThis.window.setTimeout(() => {
      scrollTargetAboveKeyboard(target, dockRef.current);
    }, 200);

    return () => {
      globalThis.cancelAnimationFrame(firstFrameId);

      if (secondFrameId !== null) {
        globalThis.cancelAnimationFrame(secondFrameId);
      }

      globalThis.window.clearTimeout(settledLayoutTimeoutId);
    };
  }, [layoutMode, target]);

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

  const keyLayout =
    layer === "alphabetic" ? ALPHABETIC_KEY_LAYOUT : SYMBOLS_KEY_LAYOUT;
  const navigationOverridesByKeyId = useMemo(
    () => getVirtualKeyboardNavigationOverrides(keyLayout),
    [keyLayout]
  );

  useEffect(() => {
    const pendingPosition = pendingLayerFocusPositionRef.current;

    if (!pendingPosition) return;

    pendingLayerFocusPositionRef.current = null;

    const nextKey =
      findClosestLayoutKeyByPosition(keyLayout, pendingPosition) ??
      findLayoutKeyById(keyLayout, VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID);
    const nextFocusId = nextKey
      ? getKeyId(nextKey)
      : VIRTUAL_KEYBOARD_TOGGLE_LAYER_KEY_ID;
    const animationFrameId = globalThis.requestAnimationFrame(() => {
      setFocus(nextFocusId);
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [keyLayout, layer, setFocus]);

  return (
    <FocusRegionContext.Provider value={null}>
      <AnimatePresence>
        {target ? (
          <motion.div
            ref={dockRef}
            className="virtual-keyboard-dock"
            data-layout-mode={layoutMode}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <NavigationLayer
              layerId={VIRTUAL_KEYBOARD_LAYER_ID}
              rootRegionId={VIRTUAL_KEYBOARD_REGION_ID}
              initialFocusId={VIRTUAL_KEYBOARD_FIRST_KEY_ID}
              restoreFocusOnUnmount={shouldRestoreNavigationFocusOnUnmount}
            >
              <motion.aside
                ref={keyboardRef}
                className="virtual-keyboard"
                role="dialog"
                aria-label="Virtual keyboard"
                initial={{ y: 32, scale: 0.98 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 24, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <GridFocusGroup
                  regionId={VIRTUAL_KEYBOARD_REGION_ID}
                  className="virtual-keyboard__keys"
                  style={
                    {
                      "--virtual-keyboard-columns": VIRTUAL_KEYBOARD_COLUMNS,
                    } as CSSProperties
                  }
                >
                  {keyLayout.map((key) => {
                    const keyStyle = getKeyStyle(key);

                    const keyId = getKeyId(key);
                    const label =
                      key.type === "character" &&
                      layer === "alphabetic" &&
                      isShiftActive
                        ? key.label.toUpperCase()
                        : key.label;
                    const shortcutLabel = getKeyShortcutLabel(key, layer);

                    return (
                      <Button
                        key={keyId}
                        type="button"
                        variant="secondary"
                        className="virtual-keyboard__key"
                        focusId={keyId}
                        focusNavigationOverrides={
                          navigationOverridesByKeyId[keyId]
                        }
                        style={keyStyle}
                        data-key-type={key.type}
                        data-active={
                          key.type === "shift" && isShiftActive
                            ? "true"
                            : undefined
                        }
                        data-pulsing={pulsingKeyId === keyId || undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleKey(key)}
                      >
                        <span className="virtual-keyboard__key-label">
                          {label}
                        </span>
                        {shortcutLabel ? (
                          <span className="virtual-keyboard__key-shortcut">
                            {shortcutLabel}
                          </span>
                        ) : null}
                      </Button>
                    );
                  })}
                </GridFocusGroup>
              </motion.aside>
            </NavigationLayer>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </FocusRegionContext.Provider>
  );
}
