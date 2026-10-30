import cn from "classnames";

export interface HeaderSelectorOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export function HeaderSelector<T extends string>({
  label,
  showLabel = true,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  showLabel?: boolean;
  options: HeaderSelectorOption<T>[];
  value: T;
  onChange: (value: T) => void;
}>) {
  return (
    <div className="leaderboards__selector">
      {showLabel && (
        <span className="leaderboards__selector-label">{label}</span>
      )}
      <div
        className="leaderboards__selector-options"
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            className={cn("leaderboards__selector-option", {
              "leaderboards__selector-option--selected": option.id === value,
            })}
            onClick={() => onChange(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
