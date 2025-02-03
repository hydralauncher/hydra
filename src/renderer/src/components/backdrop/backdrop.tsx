import "./backdrop.scss";
import cn from "classnames";

export interface BackdropProps {
  isClosing?: boolean;
  children: React.ReactNode;
}

export function Backdrop({ isClosing = false, children }: BackdropProps) {
  return (
    <div
      className={cn("backdrop", {
        "backdrop--closing": isClosing,
        "backdrop--windows": window.electron.platform === "win32",
      })}
    >
      {children}
    </div>
  );
}
