import cn from "classnames";
import { type ReactNode } from "react";
import { Button, Input } from "../../../common";

export function SettingsSection({
  title,
  description,
  children,
  danger = false,
}: Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
  danger?: boolean;
}>) {
  return (
    <section
      className={cn("game-settings-modal__section", {
        "game-settings-modal__section--danger": danger,
      })}
    >
      <div className="game-settings-modal__section-header">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function FocusableInput({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  type = "text",
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}>) {
  return (
    <Input
      label={label}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ToggleAction({
  label,
  checked,
  disabled,
  onToggle,
}: Readonly<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}>) {
  return (
    <Button
      variant={checked ? "primary" : "secondary"}
      disabled={disabled}
      onClick={onToggle}
    >
      {checked ? "On" : "Off"} - {label}
    </Button>
  );
}
