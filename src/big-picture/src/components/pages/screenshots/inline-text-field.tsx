import "./inline-text-field.scss";

import cn from "classnames";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import { FocusItem } from "../../common";
import {
  useIsLayerOnTop,
  useNavigation,
  useNavigationScreenActions,
} from "../../../hooks";
import { useFocusLayerId } from "../../context";
import { useVirtualKeyboardStore } from "../../../stores";
import type { FocusOverrides } from "../../../services";

const LIMIT_FEEDBACK_MS = 300;

export function EditingBackAction({
  onBack,
}: Readonly<{ onBack: () => void }>) {
  const isOnTop = useIsLayerOnTop(useFocusLayerId());
  useNavigationScreenActions(isOnTop ? { press: { b: onBack } } : {});
  return null;
}

export interface InlineTextFieldProps {
  focusId: string;
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  icon?: ReactNode;
  navigationOverrides?: FocusOverrides;
  navigationOrder?: number;
  sanitize?: (value: string) => string;
  onSave: (value: string) => Promise<boolean> | boolean;
}

export function InlineTextField({
  focusId,
  label,
  value,
  placeholder,
  maxLength,
  allowEmpty = false,
  disabled = false,
  className,
  icon,
  navigationOverrides,
  navigationOrder,
  sanitize,
  onSave,
}: Readonly<InlineTextFieldProps>) {
  const { setFocus } = useNavigation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [isAtLimit, setIsAtLimit] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const limitTimerRef = useRef<number>();
  const isCommittingRef = useRef(false);

  useEffect(() => () => window.clearTimeout(limitTimerRef.current), []);

  const flashLimit = () => {
    window.clearTimeout(limitTimerRef.current);
    setIsAtLimit(false);
    globalThis.window.requestAnimationFrame(() => setIsAtLimit(true));
    limitTimerRef.current = window.setTimeout(
      () => setIsAtLimit(false),
      LIMIT_FEEDBACK_MS
    );
  };

  const closeKeyboard = () => {
    const keyboard = useVirtualKeyboardStore.getState();
    if (inputRef.current && keyboard.target === inputRef.current)
      keyboard.closeKeyboard?.({ restoreFocus: false });
  };

  const openKeyboard = () => {
    const input = inputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    useVirtualKeyboardStore.getState().openKeyboard?.(input);
  };

  const startEditing = () => {
    if (disabled) return;

    setDraft(value);
    setIsEditing(true);
    globalThis.window.requestAnimationFrame(() => {
      setFocus(focusId);
      openKeyboard();
    });
  };

  const finish = () => {
    setIsEditing(false);
    setDraft("");
  };

  const revert = () => {
    closeKeyboard();
    finish();
    globalThis.window.requestAnimationFrame(() => setFocus(focusId));
  };

  const commit = async () => {
    if (isCommittingRef.current) return;

    const next = draft.trim();
    if (next === value.trim() || (!next && !allowEmpty)) {
      closeKeyboard();
      finish();
      return;
    }

    isCommittingRef.current = true;
    try {
      closeKeyboard();
      if (await onSave(next)) finish();
    } finally {
      isCommittingRef.current = false;
    }
  };

  const updateDraft = (raw: string) => {
    const cleaned = sanitize ? sanitize(raw) : raw;
    if (cleaned.length >= maxLength && raw.length > draft.length) flashLimit();
    setDraft(cleaned.slice(0, maxLength));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commit();
  };

  const handleBlur = () => {
    const keyboard = useVirtualKeyboardStore.getState();
    if (keyboard.target === inputRef.current) return;
    void commit();
  };

  return (
    <FocusItem
      id={focusId}
      navigationOrder={navigationOrder}
      navigationState={disabled ? "disabled" : "active"}
      actions={{ primary: isEditing ? openKeyboard : startEditing }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <form
        className={cn(
          "inline-text-field",
          {
            "inline-text-field--editing": isEditing,
            "inline-text-field--limit": isAtLimit,
            "inline-text-field--filled": Boolean(value),
            "inline-text-field--disabled": disabled,
          },
          className
        )}
        style={
          {
            "--inline-text-field-limit-feedback-duration": `${LIMIT_FEEDBACK_MS}ms`,
          } as CSSProperties
        }
        onSubmit={handleSubmit}
      >
        <svg className="inline-text-field__outline" aria-hidden="true">
          <rect className="inline-text-field__outline-shape" />
        </svg>
        {isEditing ? (
          <>
            <EditingBackAction onBack={revert} />
            <input
              ref={inputRef}
              className="inline-text-field__input"
              value={draft}
              placeholder={placeholder}
              aria-label={label}
              onBeforeInput={(event) => {
                const data = (event.nativeEvent as InputEvent).data;
                const input = event.currentTarget;
                const hasSelection =
                  input.selectionStart !== input.selectionEnd;
                if (data && !hasSelection && draft.length >= maxLength) {
                  event.preventDefault();
                  flashLimit();
                }
              }}
              onChange={(event) => updateDraft(event.target.value)}
              onBlur={handleBlur}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                revert();
              }}
            />
          </>
        ) : (
          <button
            type="button"
            className="inline-text-field__trigger"
            tabIndex={-1}
            title={value ? label : undefined}
            disabled={disabled}
            onClick={startEditing}
          >
            {value ? null : icon}
            <span className="inline-text-field__text">
              {value || placeholder}
            </span>
          </button>
        )}
      </form>
    </FocusItem>
  );
}
