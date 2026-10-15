import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";

import { Backdrop } from "@renderer/components/backdrop/backdrop";
import { Button } from "@renderer/components";

import {
  CHAT_REPORT_DESCRIPTION_MAX_LENGTH,
  CHAT_REPORT_REASONS,
  getReportErrorKind,
  type ChatReportErrorKind,
  type ChatReportReason,
} from "./chat-reports";

import "./chat-report-modal.scss";

// Matches the modal's scale-fade-out animation.
const CLOSE_ANIMATION_MS = 200;

export interface ChatReportModalProps {
  /** Sends the report; rejects when it wasn't saved. */
  onSubmit: (reason: ChatReportReason, description: string) => Promise<void>;
  /** Called once the dialog has animated out. */
  onClose: (isSent: boolean) => void;
}

/** Asks why a friend's message is being reported, then sends the report. */
export function ChatReportModal({
  onSubmit,
  onClose,
}: Readonly<ChatReportModalProps>) {
  const { t } = useTranslation("chat_window");

  const titleId = useId();
  const reasonName = useId();
  const detailsId = useId();
  const firstReasonRef = useRef<HTMLInputElement>(null);

  const [isClosing, setIsClosing] = useState(false);
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ChatReportErrorKind | null>(null);

  const close = useCallback(
    (isSent = false) => {
      setIsClosing(true);
      setTimeout(() => onClose(isSent), CLOSE_ANIMATION_MS);
    },
    [onClose]
  );

  // Focus starts on the reasons and goes back to where it was afterwards.
  useEffect(() => {
    const opener = document.activeElement;
    firstReasonRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // A report on its way can't be called back, so the dialog stays until it
  // settles. Nothing in it changes meanwhile; it closes once the report is in.
  const cancel = useCallback(() => {
    if (!isSending) close();
  }, [close, isSending]);

  // The dialog sits outside the app root, so this keeps Tab and clicks inside it.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.inert = true;
    return () => {
      root.inert = false;
    };
  }, []);

  // Typed details would be lost to a stray click, so only Escape closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      await onSubmit(reason, description);
      close(true);
    } catch (submitError) {
      setError(getReportErrorKind(submitError));
      setIsSending(false);
    }
  };

  return createPortal(
    <Backdrop isClosing={isClosing}>
      <dialog
        className={cn("modal", "chat-report-modal", {
          "modal--closing": isClosing,
        })}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        data-hydra-dialog
      >
        <button
          type="button"
          className="chat-report-modal__close"
          onClick={cancel}
          aria-label={t("report_close")}
        >
          <XIcon size={16} />
        </button>

        <form className="chat-report-modal__form" onSubmit={submit}>
          <h3 id={titleId} className="chat-report-modal__title">
            {t("report_message")}
          </h3>

          <fieldset className="chat-report-modal__reasons">
            <legend className="chat-report-modal__label">
              {t("report_reason_label")}
            </legend>
            <div className="chat-report-modal__reason-list">
              {CHAT_REPORT_REASONS.map((option, index) => {
                const isSelected = option === reason;

                return (
                  <label
                    key={option}
                    className={cn("chat-report-modal__reason", {
                      "chat-report-modal__reason--selected": isSelected,
                    })}
                  >
                    <input
                      ref={index === 0 ? firstReasonRef : undefined}
                      type="radio"
                      name={reasonName}
                      value={option}
                      checked={isSelected}
                      onChange={() => {
                        setReason(option);
                        setError(null);
                      }}
                      className="chat-report-modal__reason-input"
                    />
                    {t(`report_reason_${option}`)}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="chat-report-modal__details">
            <div className="chat-report-modal__details-header">
              <label htmlFor={detailsId} className="chat-report-modal__label">
                {t("report_details")}{" "}
                <span className="chat-report-modal__optional">
                  {t("report_details_optional")}
                </span>
              </label>
              <span className="chat-report-modal__counter" aria-hidden="true">
                {description.length} / {CHAT_REPORT_DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id={detailsId}
              className="chat-report-modal__textarea"
              rows={5}
              maxLength={CHAT_REPORT_DESCRIPTION_MAX_LENGTH}
              placeholder={t("report_details_placeholder")}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setError(null);
              }}
            />
          </div>

          {error && (
            <div className="chat-report-modal__error" role="alert">
              <AlertIcon size={14} className="chat-report-modal__error-icon" />
              {error === "rate_limited"
                ? t("report_rate_limited")
                : t("report_failed")}
            </div>
          )}

          <div className="chat-report-modal__actions">
            <Button type="button" theme="outline" onClick={cancel}>
              {t("cancel")}
            </Button>
            {/* It keeps its look while sending; the dialog closes on success. */}
            <Button
              type="submit"
              theme="primary"
              className={cn("chat-report-modal__send", {
                "chat-report-modal__send--busy": isSending,
              })}
              disabled={!reason || error === "rate_limited"}
              aria-disabled={isSending || undefined}
            >
              {t("report_send")}
            </Button>
          </div>
        </form>
      </dialog>
    </Backdrop>,
    document.body
  );
}
