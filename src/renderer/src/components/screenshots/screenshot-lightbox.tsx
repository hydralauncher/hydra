import { useCallback, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeClosedIcon,
  ImageIcon,
  LockIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Button } from "../button/button";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { useDate } from "@renderer/hooks";
import type { ProfileScreenshot } from "@types";

import { ScreenshotLightboxPanel } from "./screenshot-lightbox-panel";
import { ScreenshotReportModal } from "./screenshot-report-modal";
import { getScreenshotGameTitle } from "./screenshot-labels";
import type { ScreenshotCollection } from "./use-screenshot-collection";
import { useLightboxFocus, useLightboxKeyboard } from "./use-lightbox-keyboard";
import { useScreenshotSpoiler } from "./use-screenshot-spoiler";

import "./screenshot-lightbox.scss";

interface ScreenshotMediaProps {
  screenshot: ProfileScreenshot;
  onImageError: (screenshot: ProfileScreenshot) => void;
}

function ScreenshotMedia({
  screenshot,
  onImageError,
}: Readonly<ScreenshotMediaProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const hasImage = Boolean(
    screenshot.imageUrl && screenshot.imageUrl !== failedImageUrl
  );
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  if (!hasImage) {
    return (
      <div
        className="screenshot-lightbox__placeholder"
        role="img"
        aria-label={altText}
      >
        <ImageIcon size={48} />
        <span>{t("image_unavailable")}</span>
      </div>
    );
  }

  return (
    <>
      <img
        key={screenshot.imageUrl}
        className={cn("screenshot-lightbox__image", {
          "screenshot-lightbox__image--spoiler": isSpoilerHidden,
        })}
        src={screenshot.imageUrl ?? undefined}
        alt={altText}
        onError={() => {
          setFailedImageUrl(screenshot.imageUrl);
          onImageError(screenshot);
        }}
      />
      {isSpoilerHidden ? (
        <button
          type="button"
          className="screenshot-lightbox__spoiler"
          onClick={reveal}
        >
          <EyeClosedIcon size={24} />
          <span>{t("spoiler_reveal")}</span>
        </button>
      ) : null}
    </>
  );
}

interface ScreenshotLightboxStateProps {
  status: "loading" | "private" | "unavailable";
  onClose: () => void;
}

function ScreenshotLightboxState({
  status,
  onClose,
}: Readonly<ScreenshotLightboxStateProps>) {
  const { t } = useTranslation("screenshots");
  const content = {
    loading: { icon: <ImageIcon size={32} />, text: t("loading_screenshot") },
    private: { icon: <LockIcon size={32} />, text: t("screenshot_private") },
    unavailable: {
      icon: <AlertIcon size={32} />,
      text: t("screenshot_unavailable"),
    },
  }[status];

  return (
    <output className="screenshot-lightbox__state">
      <span className="screenshot-lightbox__state-icon">{content.icon}</span>
      <p>{content.text}</p>
      {status === "loading" ? null : (
        <Button theme="outline" onClick={onClose}>
          {t("close")}
        </Button>
      )}
    </output>
  );
}

interface ScreenshotLightboxNavProps {
  previousItem: ProfileScreenshot | null;
  nextItem: ProfileScreenshot | null;
  onOpen: (screenshot: ProfileScreenshot) => void;
}

function ScreenshotLightboxNav({
  previousItem,
  nextItem,
  onOpen,
}: Readonly<ScreenshotLightboxNavProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <>
      {previousItem ? (
        <button
          type="button"
          className="screenshot-lightbox__nav screenshot-lightbox__nav--previous"
          onClick={() => onOpen(previousItem)}
          aria-label={t("previous_screenshot")}
        >
          <ChevronLeftIcon size={24} />
        </button>
      ) : null}

      {nextItem ? (
        <button
          type="button"
          className="screenshot-lightbox__nav screenshot-lightbox__nav--next"
          onClick={() => onOpen(nextItem)}
          aria-label={t("next_screenshot")}
        >
          <ChevronRightIcon size={24} />
        </button>
      ) : null}
    </>
  );
}

interface ScreenshotLightboxModalsProps {
  screenshot: ProfileScreenshot;
  actions: ScreenshotCollection["actions"];
  isDeleteConfirmationVisible: boolean;
  isReportModalVisible: boolean;
  onCloseDeleteConfirmation: () => void;
  onCloseReportModal: () => void;
  onDeleted: () => void;
}

function ScreenshotLightboxModals({
  screenshot,
  actions,
  isDeleteConfirmationVisible,
  isReportModalVisible,
  onCloseDeleteConfirmation,
  onCloseReportModal,
  onDeleted,
}: Readonly<ScreenshotLightboxModalsProps>) {
  const { t } = useTranslation("screenshots");

  const handleDeleteConfirm = async () => {
    const wasDeleted = await actions.deleteScreenshot(screenshot);
    if (wasDeleted) onDeleted();
  };

  return (
    <>
      <ConfirmationModal
        visible={isDeleteConfirmationVisible}
        title={t("delete_screenshot_title")}
        descriptionText={t("delete_screenshot_description")}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        buttonsIsDisabled={actions.deletingIds.has(screenshot.id)}
        onConfirm={() => void handleDeleteConfirm()}
        onClose={onCloseDeleteConfirmation}
      />

      <ScreenshotReportModal
        visible={isReportModalVisible}
        isSubmitting={actions.reportingIds.has(screenshot.id)}
        onClose={onCloseReportModal}
        onSubmit={(values) => actions.reportScreenshot(screenshot, values)}
      />
    </>
  );
}

const getNeighbors = (items: ProfileScreenshot[], index: number) => ({
  previousItem: index > 0 ? items[index - 1] : null,
  nextItem: index >= 0 && index < items.length - 1 ? items[index + 1] : null,
});

const toOpener = (
  item: ProfileScreenshot | null,
  open: (screenshot: ProfileScreenshot) => void
) => (item ? () => open(item) : null);

function useLightboxModals(close: () => void) {
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);

  const handleClose = useCallback(() => {
    setIsDeleteConfirmationVisible(false);
    setIsReportModalVisible(false);
    close();
  }, [close]);

  return {
    isDeleteConfirmationVisible,
    isReportModalVisible,
    isBlockingModalVisible: isDeleteConfirmationVisible || isReportModalVisible,
    showDeleteConfirmation: () => setIsDeleteConfirmationVisible(true),
    hideDeleteConfirmation: () => setIsDeleteConfirmationVisible(false),
    showReportModal: () => setIsReportModalVisible(true),
    hideReportModal: () => setIsReportModalVisible(false),
    handleClose,
  };
}

interface ScreenshotLightboxContentProps {
  screenshot: ProfileScreenshot;
  collection: ScreenshotCollection;
  previousItem: ProfileScreenshot | null;
  nextItem: ProfileScreenshot | null;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

function ScreenshotLightboxContent({
  screenshot,
  collection,
  previousItem,
  nextItem,
  closeButtonRef,
  onClose,
  onRequestDelete,
  onRequestReport,
}: Readonly<ScreenshotLightboxContentProps>) {
  const { actions, onPatch, lightbox } = collection;

  return (
    <>
      <div className="screenshot-lightbox__media">
        <ScreenshotMedia
          key={screenshot.id}
          screenshot={screenshot}
          onImageError={(item) => void lightbox.refreshScreenshot(item)}
        />
        <ScreenshotLightboxNav
          previousItem={previousItem}
          nextItem={nextItem}
          onOpen={lightbox.open}
        />
      </div>

      <ScreenshotLightboxPanel
        screenshot={screenshot}
        actions={actions}
        closeButtonRef={closeButtonRef}
        onPatch={onPatch}
        onFailure={lightbox.markFailure}
        onClose={onClose}
        onRequestDelete={onRequestDelete}
        onRequestReport={onRequestReport}
      />
    </>
  );
}

interface ScreenshotLightboxPlaceholderProps {
  status: ScreenshotLightboxStateProps["status"];
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}

function ScreenshotLightboxPlaceholder({
  status,
  closeButtonRef,
  onClose,
}: Readonly<ScreenshotLightboxPlaceholderProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <>
      <button
        ref={closeButtonRef}
        type="button"
        className="screenshot-lightbox__close screenshot-lightbox__close--floating"
        onClick={onClose}
        aria-label={t("close")}
        title={t("close")}
      >
        <XIcon size={20} />
      </button>
      <ScreenshotLightboxState status={status} onClose={onClose} />
    </>
  );
}

interface ScreenshotLightboxProps {
  collection: ScreenshotCollection;
}

export function ScreenshotLightbox({
  collection,
}: Readonly<ScreenshotLightboxProps>) {
  const { t } = useTranslation("screenshots");
  const { feed, actions, lightbox } = collection;
  const { status, screenshot, index, open, close } = lightbox;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modals = useLightboxModals(close);
  const isOpen = status !== "closed";
  const { previousItem, nextItem } = getNeighbors(feed.items, index);
  const readyScreenshot = status === "ready" ? screenshot : null;

  useLightboxFocus(isOpen, closeButtonRef, `${screenshot?.id}:${status}`);
  useLightboxKeyboard({
    isEnabled: isOpen && !modals.isBlockingModalVisible,
    dialogRef,
    onClose: modals.handleClose,
    onPrevious: toOpener(previousItem, open),
    onNext: toOpener(nextItem, open),
  });

  if (!isOpen) return null;

  const dialogLabel = readyScreenshot
    ? getScreenshotGameTitle(readyScreenshot, t)
    : t("screenshot");

  return createPortal(
    <>
      <div className="screenshot-lightbox__overlay">
        <button
          type="button"
          className="screenshot-lightbox__backdrop"
          onClick={modals.handleClose}
          aria-label={t("close")}
          tabIndex={-1}
        />

        <dialog
          ref={dialogRef}
          open
          className={cn("screenshot-lightbox", {
            "screenshot-lightbox--state": !readyScreenshot,
          })}
          aria-modal="true"
          aria-label={dialogLabel}
        >
          {readyScreenshot ? (
            <ScreenshotLightboxContent
              screenshot={readyScreenshot}
              collection={collection}
              previousItem={previousItem}
              nextItem={nextItem}
              closeButtonRef={closeButtonRef}
              onClose={modals.handleClose}
              onRequestDelete={modals.showDeleteConfirmation}
              onRequestReport={modals.showReportModal}
            />
          ) : (
            <ScreenshotLightboxPlaceholder
              status={status === "ready" ? "loading" : status}
              closeButtonRef={closeButtonRef}
              onClose={modals.handleClose}
            />
          )}
        </dialog>
      </div>

      {screenshot ? (
        <ScreenshotLightboxModals
          screenshot={screenshot}
          actions={actions}
          isDeleteConfirmationVisible={modals.isDeleteConfirmationVisible}
          isReportModalVisible={modals.isReportModalVisible}
          onCloseDeleteConfirmation={modals.hideDeleteConfirmation}
          onCloseReportModal={modals.hideReportModal}
          onDeleted={modals.handleClose}
        />
      ) : null}
    </>,
    document.body
  );
}
