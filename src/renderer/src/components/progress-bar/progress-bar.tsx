interface ProgressBarProps {
  now: number;
  max: number;
  label: string;
  completed: boolean;
  trackClassName?: string;
  barClassName?: string;
}

export function ProgressBar({
  now,
  max,
  label,
  completed,
  trackClassName = "",
  barClassName = "",
}: ProgressBarProps) {
  return (
    <div className={trackClassName}>
      <div
        className={`${barClassName}${completed && barClassName ? ` ${barClassName}--platinum` : ""}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={now}
        aria-valuemin={0}
        aria-valuemax={max}
        style={{
          width: `${max > 0 ? (now / max) * 100 : 0}%`,
        }}
      />
    </div>
  );
}
