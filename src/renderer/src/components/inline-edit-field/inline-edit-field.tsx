import { useEffect, useRef, useState, type FormEvent } from "react";
import cn from "classnames";

import "./inline-edit-field.scss";

export interface InlineEditFieldProps {
  label: string;
  saveLabel: string;
  maxLength: number;
  isSaving?: boolean;
  className?: string;
  sanitize?: (value: string) => string;
  onSave: (value: string) => Promise<boolean> | boolean;
}

export function InlineEditField({
  label,
  saveLabel,
  maxLength,
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

  const cancel = () => {
    setIsEditing(false);
    setValue("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    if (!value.trim()) {
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
        { "inline-edit-field--editing": isEditing },
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
            placeholder={label}
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
            disabled={isSaving || !value.trim()}
          >
            {saveLabel}
          </button>
        </form>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="inline-edit-field__trigger"
          onClick={() => setIsEditing(true)}
        >
          {label}
        </button>
      )}
    </div>
  );
}
