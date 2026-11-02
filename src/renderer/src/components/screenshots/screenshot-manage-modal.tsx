import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "../modal/modal";
import { useFocusTrap } from "@renderer/hooks/use-focus-trap";
import type { ProfileScreenshot, ScreenshotUpdateRequest } from "@types";

import { ScreenshotOwnerControls } from "./screenshot-owner-controls";

interface ScreenshotManageModalProps {
  visible: boolean;
  screenshot: ProfileScreenshot;
  isSaving: boolean;
  onClose: () => void;
  onSave: (update: ScreenshotUpdateRequest) => Promise<boolean>;
}

export function ScreenshotManageModal({
  visible,
  screenshot,
  isSaving,
  onClose,
  onSave,
}: Readonly<ScreenshotManageModalProps>) {
  const { t } = useTranslation("screenshots");
  const contentRef = useRef<HTMLDivElement>(null);

  useFocusTrap(contentRef, visible);

  return (
    <Modal
      visible={visible}
      title={t("screenshot_settings")}
      onClose={onClose}
      clickOutsideToClose={!isSaving}
    >
      <div ref={contentRef} className="screenshot-manage-modal">
        <ScreenshotOwnerControls
          screenshot={screenshot}
          isUpdating={isSaving}
          onSave={onSave}
          onDone={onClose}
        />
      </div>
    </Modal>
  );
}
