import type { Notification } from "@types";

export const BIG_PICTURE_CLOUD_GIFT_MODAL_OPEN_EVENT =
  "hydra:big-picture:open-cloud-gift-modal";

export interface BigPictureCloudGiftModalOpenDetail {
  notification: Notification;
}

export const openBigPictureCloudGiftModal = (notification: Notification) => {
  globalThis.window.dispatchEvent(
    new CustomEvent<BigPictureCloudGiftModalOpenDetail>(
      BIG_PICTURE_CLOUD_GIFT_MODAL_OPEN_EVENT,
      { detail: { notification } }
    )
  );
};
