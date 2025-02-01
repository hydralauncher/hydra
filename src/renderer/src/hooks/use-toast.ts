import { useCallback } from "react";
import { useAppDispatch } from "./redux";
import { showToast } from "@renderer/features";

export function useToast() {
  const dispatch = useAppDispatch();

  const showSuccessToast = useCallback(
    (title: string, message?: string) => {
      dispatch(
        showToast({
          title,
          message,
          type: "success",
        })
      );
    },
    [dispatch]
  );

  const showErrorToast = useCallback(
    (title: string, message?: string) => {
      dispatch(
        showToast({
          title,
          message,
          type: "error",
        })
      );
    },
    [dispatch]
  );

  const showWarningToast = useCallback(
    (title: string, message?: string) => {
      dispatch(
        showToast({
          title,
          message,
          type: "warning",
        })
      );
    },
    [dispatch]
  );

  return { showSuccessToast, showErrorToast, showWarningToast };
}
