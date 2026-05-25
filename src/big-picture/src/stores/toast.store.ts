import { create } from "zustand";

export type BigPictureToastType = "success" | "error" | "warning";
export type BigPictureToastFallbackVisual = "hydra" | "settings" | "downloads";
export type BigPictureToastCelebration = "confetti";

export interface BigPictureToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface BigPictureToastOptions {
  message?: string;
  imageUrl?: string;
  color?: string;
  fallbackVisual?: BigPictureToastFallbackVisual;
  celebration?: BigPictureToastCelebration;
  action?: BigPictureToastAction;
  duration?: number;
}

export interface BigPictureToastPayload extends BigPictureToastOptions {
  title: string;
  type: BigPictureToastType;
}

interface BigPictureToastState {
  title: string;
  message?: string;
  imageUrl?: string;
  color?: string;
  fallbackVisual: BigPictureToastFallbackVisual;
  celebration?: BigPictureToastCelebration;
  action?: BigPictureToastAction;
  type: BigPictureToastType;
  duration: number;
  visible: boolean;
  version: number;
  showToast: (toast: BigPictureToastPayload) => void;
  showSuccessToast: (title: string, options?: BigPictureToastOptions) => void;
  showErrorToast: (title: string, options?: BigPictureToastOptions) => void;
  showWarningToast: (title: string, options?: BigPictureToastOptions) => void;
  closeToast: (version?: number) => void;
}

const DEFAULT_TOAST_DURATION = 3000;

export const useBigPictureToastStore = create<BigPictureToastState>((set) => ({
  title: "",
  message: "",
  imageUrl: undefined,
  color: undefined,
  fallbackVisual: "hydra",
  celebration: undefined,
  action: undefined,
  type: "success",
  duration: DEFAULT_TOAST_DURATION,
  visible: false,
  version: 0,
  showToast: (toast) => {
    set((state) => ({
      title: toast.title,
      message: toast.message,
      imageUrl: toast.imageUrl,
      color: toast.color,
      fallbackVisual: toast.fallbackVisual ?? "hydra",
      celebration: toast.celebration,
      action: toast.action,
      type: toast.type,
      duration: toast.duration ?? DEFAULT_TOAST_DURATION,
      visible: true,
      version: state.version + 1,
    }));
  },
  showSuccessToast: (title, options) => {
    set((state) => ({
      title,
      message: options?.message,
      imageUrl: options?.imageUrl,
      color: options?.color,
      fallbackVisual: options?.fallbackVisual ?? "hydra",
      celebration: options?.celebration,
      action: options?.action,
      type: "success",
      duration: options?.duration ?? DEFAULT_TOAST_DURATION,
      visible: true,
      version: state.version + 1,
    }));
  },
  showErrorToast: (title, options) => {
    set((state) => ({
      title,
      message: options?.message,
      imageUrl: options?.imageUrl,
      color: options?.color,
      fallbackVisual: options?.fallbackVisual ?? "hydra",
      celebration: options?.celebration,
      action: options?.action,
      type: "error",
      duration: options?.duration ?? DEFAULT_TOAST_DURATION,
      visible: true,
      version: state.version + 1,
    }));
  },
  showWarningToast: (title, options) => {
    set((state) => ({
      title,
      message: options?.message,
      imageUrl: options?.imageUrl,
      color: options?.color,
      fallbackVisual: options?.fallbackVisual ?? "hydra",
      celebration: options?.celebration,
      action: options?.action,
      type: "warning",
      duration: options?.duration ?? DEFAULT_TOAST_DURATION,
      visible: true,
      version: state.version + 1,
    }));
  },
  closeToast: (expectedVersion) => {
    set((state) => {
      if (expectedVersion !== undefined && state.version !== expectedVersion) {
        return state;
      }

      return { visible: false };
    });
  },
}));
