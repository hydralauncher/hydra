import "./local-screenshot-viewer.scss";

import {
  CaretLeftIcon,
  CaretRightIcon,
  CloudArrowUpIcon,
  ImageIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl } from "@shared";

import {
  Backdrop,
  Button,
  HorizontalFocusGroup,
  NavigationLayer,
} from "../../components";
import { FocusRegionContext } from "../../components/context";
import {
  LightboxBackAction,
  LightboxLayerReporter,
  useActiveLayerTracker,
  useLightboxShortcuts,
} from "../../components/pages/screenshots/screenshot-lightbox/lightbox-shortcuts";

const VIEWER_REGION_ID = "local-screenshot-viewer";
const VIEWER_FOCUS_IDS = {
  previous: "local-screenshot-viewer-previous",
  next: "local-screenshot-viewer-next",
  upload: "local-screenshot-viewer-upload",
  remove: "local-screenshot-viewer-delete",
  close: "local-screenshot-viewer-close",
} as const;

export interface LocalScreenshotViewerProps {
  screenshot: LocalScreenshot | null;
  index: number;
  count: number;
  title: string;
  meta: string;
  canUpload: boolean;
  isSignedIn: boolean;
  isBlocked: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

function ViewerImage({ path }: Readonly<{ path: string }>) {
  const [failedPath, setFailedPath] = useState<string | null>(null);

  if (failedPath === path) {
    return (
      <span className="local-screenshot-viewer__placeholder">
        <ImageIcon size={48} />
      </span>
    );
  }

  return (
    <img
      className="local-screenshot-viewer__image"
      src={toLocalScreenshotUrl(path)}
      alt=""
      draggable={false}
      onError={() => setFailedPath(path)}
    />
  );
}

export function LocalScreenshotViewer({
  screenshot,
  index,
  count,
  title,
  meta,
  canUpload,
  isSignedIn,
  isBlocked,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  onUpload,
  onDelete,
}: Readonly<LocalScreenshotViewerProps>) {
  const { t } = useTranslation("big_picture");
  const { handleLayerChange, isActiveLayer } = useActiveLayerTracker();
  const isOpen = screenshot !== null;

  useLightboxShortcuts({
    isOpen,
    canUseShortcuts: isOpen && !isBlocked,
    hasLocalOverlay: isBlocked,
    hasPrevious,
    hasNext,
    onPrevious,
    onNext,
    onClose,
    isActiveLayer,
  });

  if (!screenshot) return null;

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <LightboxBackAction
        enabled={!isBlocked}
        isActiveLayer={isActiveLayer}
        onClose={onClose}
      />
      <Backdrop className="local-screenshot-viewer__backdrop">
        <NavigationLayer
          rootRegionId={VIEWER_REGION_ID}
          initialFocusId={VIEWER_FOCUS_IDS.close}
          restoreFocusOnUnmount
        >
          <LightboxLayerReporter onLayerChange={handleLayerChange} />
          <dialog
            open
            className="local-screenshot-viewer"
            aria-label={title}
            aria-modal="true"
          >
            <div className="local-screenshot-viewer__stage">
              <ViewerImage path={screenshot.path} />
            </div>
            <div className="local-screenshot-viewer__info">
              <div className="local-screenshot-viewer__summary">
                <strong title={title}>{title}</strong>
                <span>
                  {meta}
                  {" · "}
                  {t("screenshots_review_counter", {
                    current: index + 1,
                    total: count,
                  })}
                </span>
              </div>
              <HorizontalFocusGroup regionId={VIEWER_REGION_ID} asChild>
                <div className="local-screenshot-viewer__actions">
                  <Button
                    variant="secondary"
                    size="icon"
                    focusId={VIEWER_FOCUS_IDS.previous}
                    disabled={!hasPrevious}
                    icon={<CaretLeftIcon size={20} />}
                    aria-label={t("screenshots_previous")}
                    title={t("screenshots_previous")}
                    onClick={onPrevious}
                  >
                    {null}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    focusId={VIEWER_FOCUS_IDS.next}
                    disabled={!hasNext}
                    icon={<CaretRightIcon size={20} />}
                    aria-label={t("screenshots_next")}
                    title={t("screenshots_next")}
                    onClick={onNext}
                  >
                    {null}
                  </Button>
                  {canUpload ? (
                    <Button
                      variant="secondary"
                      size="small"
                      focusId={VIEWER_FOCUS_IDS.upload}
                      disabled={!isSignedIn}
                      icon={<CloudArrowUpIcon size={20} />}
                      title={t(
                        isSignedIn
                          ? "screenshots_review_upload"
                          : "screenshots_settings_sign_in_to_upload"
                      )}
                      onClick={() => onUpload(screenshot)}
                    >
                      {t("screenshots_review_upload")}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="icon"
                    focusId={VIEWER_FOCUS_IDS.remove}
                    icon={<TrashIcon size={20} />}
                    aria-label={t("screenshots_settings_delete_local")}
                    title={t("screenshots_settings_delete_local")}
                    onClick={() => onDelete(screenshot)}
                  >
                    {null}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    focusId={VIEWER_FOCUS_IDS.close}
                    icon={<XIcon size={20} />}
                    aria-label={t("screenshots_close")}
                    title={t("screenshots_close")}
                    onClick={onClose}
                  >
                    {null}
                  </Button>
                </div>
              </HorizontalFocusGroup>
            </div>
          </dialog>
        </NavigationLayer>
      </Backdrop>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
