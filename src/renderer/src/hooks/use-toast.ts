import { useCallback } from "react";
import { useAppDispatch } from "./redux";
import { showToast } from "@renderer/features";

export function useToast() {
  const dispatch = useAppDispatch();

  const showSuccessToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatch(
        showToast({
          title,
          message,
          type: "success",
          duration,
        })
      );
    },
    [dispatch]
  );

  const showErrorToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatch(
        showToast({
          title,
          message,
          type: "error",
          duration,
        })
      );
    },
    [dispatch]
  );

  const showWarningToast = useCallback(
    (title: string, message?: string, duration?: number) => {
      dispatch(
        showToast({
          title,
          message,
          type: "warning",
          duration,
        })
      );
    },
    [dispatch]
  );

  return { showSuccessToast, showErrorToast, showWarningToast };
}
