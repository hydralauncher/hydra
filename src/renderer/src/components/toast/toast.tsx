import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  CheckCircleFillIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";

import * as styles from "./toast.css";
import { SPACING_UNIT } from "@renderer/theme.css";

export interface ToastProps {
  visible: boolean;
  message: string;
  type: "success" | "error" | "warning";
  duration?: number;
  onClose: () => void;
}

const INITIAL_PROGRESS = 100;

export function Toast({
  visible,
  message,
  type,
  duration = 5000,
  onClose,
}: Readonly<ToastProps>) {
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);

  const closingAnimation = useRef(-1);
  const progressAnimation = useRef(-1);

  const startAnimateClosing = useCallback(() => {
    setIsClosing(true);
    const zero = performance.now();

    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 150) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          onClose();
        }
      }
    );
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      const zero = performance.now();
      progressAnimation.current = requestAnimationFrame(
        function animateProgress(time) {
          const elapsed = time - zero;
          const progress = Math.min(elapsed / duration, 1);
          const currentValue =
            INITIAL_PROGRESS + (0 - INITIAL_PROGRESS) * progress;
          setProgress(currentValue);
          if (progress < 1) {
            progressAnimation.current = requestAnimationFrame(animateProgress);
          } else {
            cancelAnimationFrame(progressAnimation.current);
            startAnimateClosing();
          }
        }
      );

      return () => {
        setProgress(INITIAL_PROGRESS);
        cancelAnimationFrame(closingAnimation.current);
        cancelAnimationFrame(progressAnimation.current);
        setIsClosing(false);
      };
    }
    return () => {};
  }, [startAnimateClosing, duration, visible]);

  if (!visible) return null;

  return (
    <div className={styles.toast({ closing: isClosing })}>
      <div className={styles.toastContent}>
        <div
          style={{
            display: "flex",
            gap: `${SPACING_UNIT}px`,
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {type === "success" && (
              <CheckCircleFillIcon className={styles.successIcon} />
            )}

            {type === "error" && (
              <XCircleFillIcon className={styles.errorIcon} />
            )}

            {type === "warning" && <AlertIcon className={styles.warningIcon} />}

            <span style={{ fontWeight: "bold", flex: 1 }}>{message}</span>

            <button
              type="button"
              className={styles.closeButton}
              onClick={startAnimateClosing}
              aria-label="Close toast"
            >
              <XIcon />
            </button>
          </div>

          <p>
            This is a really really long message that should wrap to the next
            line
          </p>
        </div>
      </div>

      <progress className={styles.progress} value={progress} max={100} />
    </div>
  );
}
