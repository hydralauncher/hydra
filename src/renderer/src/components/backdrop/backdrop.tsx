import * as styles from "./backdrop.css";

export interface BackdropProps {
  isClosing?: boolean;
  children: React.ReactNode;
}

export function Backdrop({ isClosing = false, children }: BackdropProps) {
  return (
    <div
      className={styles.backdrop({
        closing: isClosing,
        windows: window.electron.platform === "win32",
      })}
    >
      {children}
    </div>
  );
}
