import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { IS_DESKTOP } from "../constants";
import { Button, Input, Modal, VerticalFocusGroup } from "./common";

const AUTO_DISMISS_AFTER_MS = 5 * 60 * 1000;
const PIN_LENGTH = 4;

const PAIRING_REGION_ID = "big-picture-stream-pairing";
const PIN_INPUT_FOCUS_ID = "big-picture-stream-pairing-pin";
const SUBMIT_FOCUS_ID = "big-picture-stream-pairing-submit";

/**
 * Big Picture counterpart of the main window pairing prompt: the main window
 * is hidden while Big Picture is open, so the PIN prompt has to exist here for
 * a pairing request to reach the user.
 */
export function StreamPairingModal() {
  const [visible, setVisible] = useState(false);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation("modal");

  const close = useCallback(() => {
    setVisible(false);
    setPin("");
    setError(null);
  }, []);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeRequested =
      globalThis.window.electron.onStreamPairingRequest(() => setVisible(true));
    const unsubscribeFinished =
      globalThis.window.electron.onStreamPairingFinished(() => close());

    return () => {
      unsubscribeRequested();
      unsubscribeFinished();
    };
  }, [close]);

  useEffect(() => {
    if (!visible) return;

    const timeout = setTimeout(() => close(), AUTO_DISMISS_AFTER_MS);
    return () => clearTimeout(timeout);
  }, [visible, close]);

  const canSubmit = pin.length === PIN_LENGTH && /^\d{4}$/.test(pin);

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    globalThis.window.electron
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
      initialFocusId={PIN_INPUT_FOCUS_ID}
    >
      <VerticalFocusGroup regionId={PAIRING_REGION_ID}>
        <Input
          ref={inputRef}
          focusId={PIN_INPUT_FOCUS_ID}
          type="text"
          inputMode="numeric"
          maxLength={PIN_LENGTH}
          placeholder={t("stream_pairing_placeholder")}
          value={pin}
          error={Boolean(error)}
          hint={error ?? undefined}
          onChange={(event) =>
            setPin(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
        />
        <Button
          focusId={SUBMIT_FOCUS_ID}
          disabled={!canSubmit || submitting}
          loading={submitting}
          onClick={handleSubmit}
        >
          {t("stream_pairing_submit")}
        </Button>
      </VerticalFocusGroup>
    </Modal>
  );
}
