import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  CheckCircleFillIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";

import "./toast.scss";
import cn from "classnames";

export interface ToastProps {
  visible: boolean;
  message: string;
  type: "success" | "error" | "warning";
  onClose: () => void;
}

const INITIAL_PROGRESS = 100;

export function Toast({ visible, message, type, onClose }: ToastProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);

  const closingAnimation = useRef(-1);
  const progressAnimation = useRef(-1);

  const startAnimateClosing = useCallback(() => {
    setIsClosing(true);
    const zero = performance.now();

    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 200) {
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

          const progress = Math.min(elapsed / 2500, 1);
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
  }, [startAnimateClosing, visible]);

  if (!visible) return null;

  return (
    <div
      className={cn("toast", {
        "toast__closing": isClosing,
      })}
    >
      <div className="toast__content">
        <div style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
          {type === "success" && (
            <CheckCircleFillIcon className="toast__success-icon" />
          )}

          {type === "error" && (
            <XCircleFillIcon className="toast__error-icon" />
          )}

          {type === "warning" && <AlertIcon className="toast__warning-icon" />}
          <span style={{ fontWeight: "bold" }}>{message}</span>
        </div>

        <button
          type="button"
          className="toast__close-button"
          onClick={startAnimateClosing}
          aria-label="Close toast"
        >
          <XIcon />
        </button>
      </div>

      <progress className="toast__progress" value={progress} max={100} />
    </div>
  );
}
