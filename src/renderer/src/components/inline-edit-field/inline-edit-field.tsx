import { useEffect, useRef, useState, type FormEvent } from "react";
import cn from "classnames";

import "./inline-edit-field.scss";

export interface InlineEditFieldProps {
  label: string;
  saveLabel: string;
  maxLength: number;
  initialValue?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  isSaving?: boolean;
  className?: string;
  sanitize?: (value: string) => string;
  onSave: (value: string) => Promise<boolean> | boolean;
}

export function InlineEditField({
  label,
  saveLabel,
  maxLength,
  initialValue = "",
  placeholder = label,
  allowEmpty = false,
  disabled = false,
  isSaving = false,
  className,
  sanitize,
  onSave,
}: Readonly<InlineEditFieldProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
    else if (wasEditingRef.current) triggerRef.current?.focus();
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  const triggerText = initialValue || placeholder;
  const canSubmit = allowEmpty || Boolean(value.trim());

  const startEditing = () => {
    setValue(initialValue);
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setValue("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    if (!canSubmit) {
      cancel();
      return;
    }
    if (await onSave(value)) {
      setIsEditing(false);
      setValue("");
    }
  };

  return (
    <div
      className={cn(
        "inline-edit-field",
        {
          "inline-edit-field--editing": isEditing,
          "inline-edit-field--disabled": disabled,
        },
        className
      )}
    >
      <svg className="inline-edit-field__outline" aria-hidden="true">
        <rect className="inline-edit-field__outline-shape" />
      </svg>

      {isEditing ? (
        <form
          className="inline-edit-field__form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <input
            ref={inputRef}
            className="inline-edit-field__input"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            disabled={isSaving}
            onChange={(event) =>
              setValue(
                sanitize ? sanitize(event.target.value) : event.target.value
              )
            }
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }}
          />
          <span className="inline-edit-field__counter">
            {value.length}/{maxLength}
          </span>
          <button
            type="submit"
            className="inline-edit-field__save"
            disabled={isSaving || !canSubmit}
          >
            {saveLabel}
          </button>
        </form>
      ) : (
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
