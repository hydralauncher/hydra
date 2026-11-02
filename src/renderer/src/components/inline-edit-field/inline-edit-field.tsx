import { useEffect, useRef, useState } from "react";
import cn from "classnames";

import "./inline-edit-field.scss";

const LIMIT_FEEDBACK_MS = 300;

export interface InlineEditFieldProps {
  label: string;
  maxLength: number;
  initialValue?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  isSaving?: boolean;
  className?: string;
  multiline?: boolean;
  sanitize?: (value: string) => string;
  onSave: (value: string) => Promise<boolean> | boolean;
}

type InlineEditElement = HTMLInputElement | HTMLTextAreaElement;

const isTextKey = (event: React.KeyboardEvent<InlineEditElement>) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

const getSelectionLength = (input: InlineEditElement) =>
  (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);

export function InlineEditField({
  label,
  maxLength,
  initialValue = "",
  placeholder = label,
  allowEmpty = false,
  disabled = false,
  isSaving = false,
  className,
  multiline = false,
  sanitize,
  onSave,
}: Readonly<InlineEditFieldProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const [isAtLimit, setIsAtLimit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InlineEditElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isEditingRef = useRef(false);
  const shouldRestoreFocusRef = useRef(false);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      return;
    }
    if (shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [isEditing]);

  useEffect(
    () => () => {
      if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    },
    []
  );

  const triggerText = initialValue || placeholder;

  const startEditing = () => {
    setLockedWidth(rootRef.current?.offsetWidth || null);
    setValue(initialValue);
    isEditingRef.current = true;
    setIsEditing(true);
  };

  const finishEditing = (restoreFocus: boolean) => {
    isEditingRef.current = false;
    shouldRestoreFocusRef.current = restoreFocus;
    setIsEditing(false);
    setLockedWidth(null);
    setIsAtLimit(false);
  };

  const cancel = () => {
    if (!isEditingRef.current) return;
    finishEditing(true);
  };

  const commit = async (restoreFocus: boolean) => {
    if (!isEditingRef.current || isSaving) return;
    if (!allowEmpty && !value.trim()) {
      finishEditing(restoreFocus);
      return;
    }
    if (value === initialValue) {
      finishEditing(restoreFocus);
      return;
    }
    if (await onSave(value)) finishEditing(restoreFocus);
  };

  const signalLimit = () => {
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    setIsAtLimit(false);
    requestAnimationFrame(() => setIsAtLimit(true));
    limitTimerRef.current = setTimeout(() => {
      setIsAtLimit(false);
      limitTimerRef.current = null;
    }, LIMIT_FEEDBACK_MS);
  };

  const handleKeyDown = (event: React.KeyboardEvent<InlineEditElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (
      isTextKey(event) &&
      value.length >= maxLength &&
      getSelectionLength(event.currentTarget) === 0
    ) {
      signalLimit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<InlineEditElement>) => {
    const pasted = event.clipboardData.getData("text");
    const room =
      maxLength - value.length + getSelectionLength(event.currentTarget);
    if (pasted.length > room) signalLimit();
  };

  const handleChange = (event: React.ChangeEvent<InlineEditElement>) => {
    const raw = event.target.value;
    const next = sanitize ? sanitize(raw) : raw;
    if (raw.length > maxLength || next.length > maxLength) signalLimit();
    setValue(next.slice(0, maxLength));
  };

  const editorProps = {
    className: "inline-edit-field__input",
    value,
    maxLength,
    placeholder,
    "aria-label": label,
    "aria-invalid": isAtLimit || undefined,
    disabled: isSaving,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onBlur: () => void commit(false),
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "inline-edit-field",
        {
          "inline-edit-field--editing": isEditing,
          "inline-edit-field--disabled": disabled,
          "inline-edit-field--limit": isAtLimit,
          "inline-edit-field--multiline": multiline,
        },
        className
      )}
      style={lockedWidth === null ? undefined : { width: lockedWidth }}
    >
      <svg className="inline-edit-field__outline" aria-hidden="true">
        <rect className="inline-edit-field__outline-shape" />
      </svg>

      {isEditing && multiline && (
        <textarea
          ref={(element) => {
            inputRef.current = element;
          }}
          {...editorProps}
        />
      )}

      {isEditing && !multiline && (
        <input
          ref={(element) => {
            inputRef.current = element;
          }}
          {...editorProps}
        />
      )}

      {!isEditing && (
        <button
          ref={triggerRef}
          type="button"
          className={cn("inline-edit-field__trigger", {
            "inline-edit-field__trigger--filled": Boolean(initialValue),
          })}
          title={triggerText === label ? undefined : label}
          disabled={disabled}
          onClick={startEditing}
        >
          {triggerText}
        </button>
      )}
    </div>
  );
}
