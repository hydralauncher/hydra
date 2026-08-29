import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import type { HydraCloudFeature } from "@types";
import "./cloud-subscription-modal.scss";

// The remote page is a fixed 1536x836 design: below that width its right-hand
// column overflows and is clipped mid-word. Render it at its design size and
// scale the whole frame instead, so the layout never reflows.
const CLOUD_DESIGN_WIDTH = 1536;
const CLOUD_DESIGN_HEIGHT = 836;

export interface CloudSubscriptionModalProps {
  visible: boolean;
  onClose: () => void;
  // Which card the promo highlights. Forwarded to the iframe.
  feature?: HydraCloudFeature;
}

export function CloudSubscriptionModal({
  visible,
  onClose,
  feature,
}: CloudSubscriptionModalProps) {
  const { t, i18n } = useTranslation("hydra_cloud");
  const lang = i18n.language?.split("-")[0] || "en";
  const [isClosing, setIsClosing] = useState(false);
  const [cloudIframeUrl, setCloudIframeUrl] = useState("");
  const [isIframeUnavailable, setIsIframeUnavailable] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cloudIframeOrigin = cloudIframeUrl
    ? new URL(cloudIframeUrl).origin
    : "";

  const seedRef = useRef({ lang, feature });
  seedRef.current = { lang, feature };

  const iframeSrc = useMemo(() => {
    if (!cloudIframeUrl) return undefined;

    const { lang: seedLang, feature: seedFeature } = seedRef.current;

    return `${cloudIframeUrl}?lng=${seedLang}${
      seedFeature ? `&feature=${seedFeature}` : ""
    }`;
  }, [cloudIframeUrl]);

  useEffect(() => {
    let isMounted = true;
    const getCloudIframeUrl = window.electron.getCloudIframeUrl;

    // Remote renderer/preload can be deployed from different commits.
    if (typeof getCloudIframeUrl !== "function") {
      setIsIframeUnavailable(true);
      return;
    }

    getCloudIframeUrl()
      .then((url) => {
        if (isMounted) setCloudIframeUrl(url);
      })
      .catch(() => {
        if (isMounted) setIsIframeUnavailable(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) return;

    const updateScale = () => {
      const { width } = frame.getBoundingClientRect();

      if (!width) return;

      frame.style.setProperty(
        "--cloud-iframe-scale",
        `${width / CLOUD_DESIGN_WIDTH}`
      );
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(frame);

    return () => resizeObserver.disconnect();
  }, []);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    const start = performance.now();
    requestAnimationFrame(function step(time) {
      if (time - start <= 250) {
        requestAnimationFrame(step);
      } else {
        setIsClosing(false);
        onClose();
      }
    });
  }, [onClose]);

  // Subscribe + escape handling only while the modal is open.
  useEffect(() => {
    if (!visible) return;

    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== cloudIframeOrigin ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      if (
        event.data?.source === "hydra-cloud" &&
        event.data.type === "subscribe"
      ) {
        window.electron.openCheckout();
        handleClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, handleClose, cloudIframeOrigin]);

  // Sync the launcher language + selected feature to the (already loaded)
  // iframe each time it opens, so it can switch cards without reloading.
  const syncIframeState = useCallback(() => {
    if (!cloudIframeOrigin) return;

    iframeRef.current?.contentWindow?.postMessage(
      { source: "hydra", lang, feature },
      cloudIframeOrigin
    );
  }, [cloudIframeOrigin, lang, feature]);

  useEffect(() => {
    if (visible) syncIframeState();
  }, [visible, syncIframeState]);

  // The overlay (and the iframe inside it) stays mounted for the lifetime of the
  // profile so the frame is preloaded; only its visibility is toggled. A hidden
  // iframe still loads its document, so opening is instant with no layout shift.
  const state = isClosing ? "closing" : visible ? "open" : "hidden";

  const handleClickOpenCheckout = () => {
    window.electron.openCheckout();
    handleClose();
  };

  return createPortal(
    <div
      className={`cloud-subscription-modal__overlay cloud-subscription-modal__overlay--${state}`}
      role="dialog"
      aria-hidden={state === "hidden"}
      onPointerDown={(event) => {
        if (visible && !isClosing && event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div ref={frameRef} className="cloud-subscription-modal__frame">
        <button
          type="button"
          className="cloud-subscription-modal__close"
          onClick={handleClose}
          aria-label="Close"
          tabIndex={state === "hidden" ? -1 : 0}
        >
          <XIcon size={20} />
        </button>
        {isIframeUnavailable ? (
          <div
            className="cloud-subscription-modal__fallback"
            data-hydra-cloud-feature={feature}
          >
            {t("hydra_cloud_feature_found")}
            <Button onClick={handleClickOpenCheckout}>{t("learn_more")}</Button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            title="Hydra Cloud"
            className="cloud-subscription-modal__iframe"
            src={iframeSrc}
            width={CLOUD_DESIGN_WIDTH}
            height={CLOUD_DESIGN_HEIGHT}
            onLoad={syncIframeState}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
