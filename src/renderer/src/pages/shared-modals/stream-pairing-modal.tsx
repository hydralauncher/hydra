import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";

import "./stream-pairing-modal.scss";

const AUTO_DISMISS_AFTER_MS = 5 * 60 * 1000;

export function StreamPairingModal() {
  const [visible, setVisible] = useState(false);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation("modal");

  const close = () => {
    setVisible(false);
    setPin("");
    setError(null);
  };

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    const unsubscribeRequested = window.electron.onStreamPairingRequest(() =>
      setVisible(true)
    );
    const unsubscribeFinished = window.electron.onStreamPairingFinished(() =>
      close()
    );

    return () => {
      unsubscribeRequested();
      unsubscribeFinished();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const timeout = setTimeout(() => close(), AUTO_DISMISS_AFTER_MS);
    return () => clearTimeout(timeout);
  }, [visible]);

  const canSubmit = pin.length === 4 && /^\d{4}$/.test(pin);

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    window.electron
      .submitStreamPairingPin(pin)
      .then((result) => {
        if (result === "ok") {
          close();
        } else {
          setPin("");
          setError(
            t(
              result === "invalid-pin"
                ? "stream_pairing_error_invalid_pin"
                : "stream_pairing_error_no_session"
            )
          );
        }
      })
      .catch(() => setError(t("stream_pairing_error_no_session")))
      .finally(() => setSubmitting(false));
  };

  return (
    <Modal
      visible={visible}
      title={t("stream_pairing_title")}
      description={t("stream_pairing_description")}
      onClose={close}
    >
      <div className="stream-pairing-modal__form">
        <input
          className="stream-pairing-modal__input"
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder={t("stream_pairing_placeholder")}
          value={pin}
          onChange={(event) =>
            setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
        />
        <Button
          theme="primary"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
        >
          {t("stream_pairing_submit")}
        </Button>
        {error && <span className="stream-pairing-modal__error">{error}</span>}
      </div>
    </Modal>
  );
}
