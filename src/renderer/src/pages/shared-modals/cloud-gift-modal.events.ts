import type { Notification } from "@types";

export const CLOUD_GIFT_MODAL_OPEN_EVENT = "hydra:open-cloud-gift-modal";

export interface CloudGiftModalOpenDetail {
  notification: Notification;
}

export const openCloudGiftModal = (notification: Notification) => {
  window.dispatchEvent(
    new CustomEvent<CloudGiftModalOpenDetail>(CLOUD_GIFT_MODAL_OPEN_EVENT, {
      detail: { notification },
    })
  );
};
