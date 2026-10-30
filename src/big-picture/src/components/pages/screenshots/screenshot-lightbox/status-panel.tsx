import { ImageIcon, LockSimpleIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  Backdrop,
  Button,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import {
  FocusLayerReporter,
  FocusRegionContext,
  useFocusLayerTracker,
} from "../../../context";
import { useInputModeStore } from "../../../../stores";
import { LightboxBackAction } from "./lightbox-shortcuts";

const STATUS_CLOSE_FOCUS_ID = "screenshot-lightbox-status-close";
const STATUS_REGION_ID = "screenshot-lightbox-status";

const shouldRestoreFocus = () =>
  useInputModeStore.getState().mode === "gamepad";

export type ScreenshotLightboxPendingStatus =
  | "loading"
  | "private"
  | "unavailable";

interface ScreenshotLightboxStatusPanelProps {
  status: ScreenshotLightboxPendingStatus;
  onClose: () => void;
  onLayerIdChange?: (layerId: string | null) => void;
}

export function ScreenshotLightboxStatusPanel({
  status,
  onClose,
  onLayerIdChange,
}: Readonly<ScreenshotLightboxStatusPanelProps>) {
  const { t } = useTranslation("big_picture");
  const { layerId, handleLayerChange, isActiveLayer } = useFocusLayerTracker();
  const reportLayerChange = useCallback(
    (nextLayerId: string | null) => {
      handleLayerChange(nextLayerId);
      onLayerIdChange?.(nextLayerId);
    },
    [handleLayerChange, onLayerIdChange]
  );
  const messages = {
    loading: {
      icon: <ImageIcon size={40} />,
      title: t("screenshots_loading"),
    },
    private: {
      icon: <LockSimpleIcon size={40} />,
      title: t("screenshots_error_private"),
    },
    unavailable: {
      icon: <ProhibitIcon size={40} />,
      title: t("screenshots_error_unavailable"),
    },
  } as const;
  const message = messages[status];
  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <LightboxBackAction
        enabled
        layerId={layerId}
        isActiveLayer={isActiveLayer}
        onClose={onClose}
      />
      <Backdrop className="screenshot-lightbox__backdrop">
        <div
          className="screenshot-lightbox__overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <NavigationLayer
            rootRegionId={STATUS_REGION_ID}
            initialFocusId={STATUS_CLOSE_FOCUS_ID}
            restoreFocusOnUnmount={shouldRestoreFocus}
          >
            <FocusLayerReporter onLayerChange={reportLayerChange} />
            <VerticalFocusGroup regionId={STATUS_REGION_ID} asChild>
              <div
                className="screenshot-lightbox__status"
                role="alertdialog"
                aria-label={message.title}
              >
                {message.icon}
                <p>{message.title}</p>
                <Button
                  variant="secondary"
                  focusId={STATUS_CLOSE_FOCUS_ID}
                  onClick={onClose}
                >
                  {t("screenshots_close")}
                </Button>
              </div>
            </VerticalFocusGroup>
          </NavigationLayer>
        </div>
      </Backdrop>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
