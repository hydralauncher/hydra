import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon, XIcon } from "@primer/octicons-react";

import { errorBus } from "./error-bus";
import { getErrorMessage, getErrorStack } from "./format-error";
import { formatOrigin, getErrorOrigin } from "./parse-stack";
import "./global-error-overlay.scss";

interface CapturedError {
  id: number;
  message: string;
  stack: string;
  origin: string;
}

const MAX_VISIBLE = 3;

const appendError = (errors: CapturedError[], next: CapturedError) =>
  [...errors, next].slice(-MAX_VISIBLE);

const dropByMessage = (errors: CapturedError[], message: string) =>
  errors.filter((error) => error.message !== message);

const dropById = (errors: CapturedError[], id: number) =>
  errors.filter((error) => error.id !== id);

export function GlobalErrorOverlay() {
  const { t } = useTranslation("app");
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const idRef = useRef(0);
  const claimedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pushError = (value: unknown) => {
      const message = getErrorMessage(value);
      if (!message || claimedRef.current.has(message)) return;

      idRef.current += 1;

      const stack = getErrorStack(value);
      const origin = getErrorOrigin(stack);

      setErrors((prev) =>
        appendError(prev, {
          id: idRef.current,
          message,
          stack,
          origin: origin ? formatOrigin(origin) : "",
        })
      );
    };

    const onError = (event: ErrorEvent) =>
      pushError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      pushError(event.reason);

    const onBoundaryHandled = (message: string) => {
      claimedRef.current.add(message);
      setErrors((prev) => dropByMessage(prev, message));
      setTimeout(() => claimedRef.current.delete(message), 1000);
    };

    const unsubscribe = errorBus.onBoundaryHandled(onBoundaryHandled);

    globalThis.addEventListener("error", onError);
    globalThis.addEventListener("unhandledrejection", onRejection);

    return () => {
      unsubscribe();
      globalThis.removeEventListener("error", onError);
      globalThis.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const dismiss = (id: number) => {
    setErrors((prev) => dropById(prev, id));
  };

  if (errors.length === 0) return null;

  return (
    <div className="global-error-overlay">
      {errors.map((error) => (
        <div key={error.id} className="global-error-overlay__card">
          <div className="global-error-overlay__header">
            <AlertIcon size={16} className="global-error-overlay__icon" />
            <span className="global-error-overlay__title">
              {t("error_overlay_title")}
            </span>
            <button
              type="button"
              className="global-error-overlay__dismiss"
              onClick={() => dismiss(error.id)}
              aria-label={t("error_overlay_dismiss")}
            >
              <XIcon size={14} />
            </button>
          </div>

          <p className="global-error-overlay__message">{error.message}</p>

          {error.origin && (
            <p className="global-error-overlay__origin">{error.origin}</p>
          )}

          {error.stack && (
            <details className="global-error-overlay__details">
              <summary>{t("error_overlay_details")}</summary>
              <pre className="global-error-overlay__stack">
                <code>{error.stack}</code>
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
