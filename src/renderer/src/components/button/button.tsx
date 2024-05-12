import cn from "classnames";
import * as styles from "./button.css";

export interface ButtonProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  theme?: keyof typeof styles.button;
}

export function Button({
  children,
  theme = "primary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(styles.button[theme], className)}
      {...props}
    >
      {children}
    </button>
  );
}
