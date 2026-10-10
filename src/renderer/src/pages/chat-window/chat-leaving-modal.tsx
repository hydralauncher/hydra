import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  LinkExternalIcon,
  LockIcon,
  UnlockIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { Backdrop } from "@renderer/components/backdrop/backdrop";
import { Button, CheckboxField } from "@renderer/components";

import { trustLinkHost } from "./chat-trusted-links";

import "./chat-leaving-modal.scss";

const electron = globalThis.electron as Electron;

// Matches the modal's scale-fade-out animation.
const CLOSE_ANIMATION_MS = 200;
// Only one prompt is open at a time, so the mask id can be fixed.
const ICON_MASK_ID = "chat-leaving-icon-cut";

/** Hydra's mark with an alert badge cut into its corner. */
function ChatLeavingIcon({ isInsecure }: { isInsecure: boolean }) {
  return (
    <svg
      className={cn("chat-leaving-modal__icon", {
        "chat-leaving-modal__icon--insecure": isInsecure,
      })}
      viewBox="-4 0 67 55"
      width={72}
      height={59}
      aria-hidden="true"
    >
      <defs>
        <mask
          id={ICON_MASK_ID}
          maskUnits="userSpaceOnUse"
          x={-4}
          y={0}
          width={67}
          height={55}
        >
          <rect x={-4} y={0} width={67} height={55} fill="#fff" />
          <circle cx={54} cy={46} r={10.5} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${ICON_MASK_ID})`}>
        <HydraIcon x={0} y={0} width={55} height={49} />
      </g>
      <circle
        className="chat-leaving-modal__icon-badge"
        cx={54}
        cy={46}
        r={8}
      />
      <path className="chat-leaving-modal__icon-mark" d="M54 41.6v4.8" />
      <circle
        className="chat-leaving-modal__icon-dot"
        cx={54}
        cy={50}
        r={1.3}
      />
    </svg>
  );
}

export interface ChatLeavingModalProps {
  /** An http or https link from a message. */
  url: string;
  onClose: () => void;
}

/** Asks before a link from a message opens in the browser. */
export function ChatLeavingModal({ url, onClose }: ChatLeavingModalProps) {
  const { t } = useTranslation("chat_window");

  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const goBackRef = useRef<HTMLButtonElement>(null);

  const [isClosing, setIsClosing] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const { hostname } = new URL(url);
  const isInsecure = url.startsWith("http:");

  const close = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  const openLink = () => {
    if (dontAskAgain && !isInsecure) trustLinkHost(hostname);
    void electron.openExternal(url);
    close();
  };

  // The safe choice takes focus, which goes back to the link afterwards.
  useEffect(() => {
    const opener = document.activeElement;
    goBackRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) close();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [close]);

  return createPortal(
    <Backdrop isClosing={isClosing}>
      <div
        ref={dialogRef}
        className={cn("modal", "chat-leaving-modal", {
          "modal--closing": isClosing,
        })}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-hydra-dialog
      >
        <button
          type="button"
          className="chat-leaving-modal__close"
          onClick={close}
          aria-label={t("leaving_close")}
        >
          <XIcon size={16} />
        </button>

        <div className="chat-leaving-modal__header">
          <ChatLeavingIcon isInsecure={isInsecure} />
          <div className="chat-leaving-modal__heading">
            <h3 id={titleId} className="chat-leaving-modal__title">
              {t("leaving_title")}
            </h3>
            <p id={descriptionId} className="chat-leaving-modal__description">
              {t("leaving_description")}
            </p>
          </div>
        </div>

        <div className="chat-leaving-modal__content">
          <div
            className={cn("chat-leaving-modal__destination", {
              "chat-leaving-modal__destination--insecure": isInsecure,
            })}
          >
            <div className="chat-leaving-modal__host">
              {isInsecure ? (
                <UnlockIcon
                  size={14}
                  className="chat-leaving-modal__host-icon"
                />
              ) : (
                <LockIcon
                  size={14}
                  className="chat-leaving-modal__host-icon"
                  aria-label={t("leaving_secure_connection")}
                />
              )}
              <span className="chat-leaving-modal__host-name">{hostname}</span>
              {isInsecure && (
                <span className="chat-leaving-modal__not-secure">
                  {t("leaving_not_secure")}
                </span>
              )}
            </div>
            <span className="chat-leaving-modal__url" title={url}>
              {url}
            </span>
          </div>

          <p className="chat-leaving-modal__warning">
            {isInsecure ? t("leaving_insecure_warning") : t("leaving_warning")}
          </p>

          {/* Only secure sites can skip the prompt. */}
          {!isInsecure && (
            <CheckboxField
              checked={dontAskAgain}
              onChange={(event) => setDontAskAgain(event.target.checked)}
              label={
                <Trans
                  i18nKey="leaving_trust_host"
                  ns="chat_window"
                  values={{ host: hostname }}
                  components={{ strong: <strong /> }}
                />
              }
            />
          )}

          <div className="chat-leaving-modal__actions">
            <Button ref={goBackRef} theme="outline" onClick={close}>
              {t("go_back")}
            </Button>
            <Button theme="primary" onClick={openLink}>
              {isInsecure ? t("open_anyway") : t("open_link")}
              <LinkExternalIcon size={14} />
            </Button>
          </div>
        </div>
      </div>
    </Backdrop>,
    document.body
  );
}
