import { useCallback } from "react";
import {
  type BigPictureToastOptions,
  type BigPictureToastPayload,
  useBigPictureToastStore,
} from "../stores";

export function useBigPictureToast() {
  const showToastStore = useBigPictureToastStore((state) => state.showToast);
  const showSuccessToastStore = useBigPictureToastStore(
    (state) => state.showSuccessToast
  );
  const showErrorToastStore = useBigPictureToastStore(
    (state) => state.showErrorToast
  );
  const showWarningToastStore = useBigPictureToastStore(
    (state) => state.showWarningToast
  );
  const closeToast = useBigPictureToastStore((state) => state.closeToast);

  const showToast = useCallback(
    (payload: BigPictureToastPayload) => {
      showToastStore(payload);
    },
    [showToastStore]
  );

  const showSuccessToast = useCallback(
    (title: string, options?: BigPictureToastOptions) => {
      showSuccessToastStore(title, options);
    },
    [showSuccessToastStore]
  );

  const showErrorToast = useCallback(
    (title: string, options?: BigPictureToastOptions) => {
      showErrorToastStore(title, options);
    },
    [showErrorToastStore]
  );

  const showWarningToast = useCallback(
    (title: string, options?: BigPictureToastOptions) => {
      showWarningToastStore(title, options);
    },
    [showWarningToastStore]
  );

  return {
    showToast,
    showSuccessToast,
    showErrorToast,
    showWarningToast,
    closeToast,
  };
}
