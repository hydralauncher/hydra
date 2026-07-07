import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon, SyncIcon } from "@primer/octicons-react";

import { Button } from "../button/button";
import { getErrorMessage, getErrorStack } from "./format-error";
import { formatOrigin, getErrorOrigin } from "./parse-stack";

import "./error-fallback.scss";

export interface ErrorFallbackProps {
  error: unknown;
  componentStack?: string;
}

export function ErrorFallback({
  error,
  componentStack,
}: Readonly<ErrorFallbackProps>) {
  const { t } = useTranslation("app");
  const [copied, setCopied] = useState(false);

  const message = getErrorMessage(error);
  const stack = getErrorStack(error);
  const origin = getErrorOrigin(stack);

  const handleRestart = () => {
    globalThis.location.hash = "#/";
    globalThis.location.reload();
  };

  const handleCopy = () => {
    const payload = [
      message,
      origin ? `Origin: ${formatOrigin(origin)}` : "",
      stack,
      componentStack ? `Component trace:${componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    navigator.clipboard
      .writeText(payload)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* clipboard unavailable, ignore */
      });
  };

  return (
    <div className="error-fallback">
      <div className="error-fallback__content">
        <AlertIcon size={48} className="error-fallback__icon" />

        <h1 className="error-fallback__title">{t("error_boundary_title")}</h1>

        <p className="error-fallback__description">
          {t("error_boundary_description")}
        </p>

        <p className="error-fallback__message">{message}</p>

        {origin && (
          <p className="error-fallback__origin">
            <span className="error-fallback__origin-label">
              {t("error_boundary_origin")}
            </span>
            {formatOrigin(origin)}
          </p>
        )}

        {stack && (
          <pre className="error-fallback__stack">
            <code>{stack}</code>
          </pre>
        )}

        {componentStack && (
          <details className="error-fallback__component-trace">
            <summary>{t("error_boundary_component_trace")}</summary>
            <pre className="error-fallback__stack">
              <code>{componentStack.trim()}</code>
            </pre>
          </details>
        )}

        <div className="error-fallback__actions">
          <Button theme="primary" onClick={handleRestart}>
            <SyncIcon />
            {t("error_boundary_restart")}
          </Button>

          <Button theme="outline" onClick={handleCopy}>
            {copied
              ? t("error_boundary_copied")
              : t("error_boundary_copy_error")}
          </Button>
        </div>
      </div>
    </div>
  );
}
