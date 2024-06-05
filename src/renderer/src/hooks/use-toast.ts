import { useCallback } from "react";
import { useAppDispatch } from "./redux";
import { showToast } from "@renderer/features";

export function useToast() {
  const dispatch = useAppDispatch();

  const showSuccessToast = useCallback(
    (message: string) => {
      dispatch(
        showToast({
          message,
          type: "success",
        })
      );
    },
    [dispatch]
  );

  const showErrorToast = useCallback(
    (message: string) => {
      dispatch(
        showToast({
          message,
          type: "error",
        })
      );
    },
    [dispatch]
  );

  return { showSuccessToast, showErrorToast };
}
