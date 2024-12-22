import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setHydraCloudModalVisible,
  setHydraCloudModalHidden,
} from "@renderer/features";

export function useSubscription() {
  const dispatch = useAppDispatch();

  const { isHydraCloudModalVisible } = useAppSelector(
    (state) => state.subscription
  );

  const showHydraCloudModal = useCallback(() => {
    dispatch(setHydraCloudModalVisible());
  }, [dispatch]);

  const hideHydraCloudModal = useCallback(() => {
    dispatch(setHydraCloudModalHidden());
  }, [dispatch]);

  return {
    isHydraCloudModalVisible,
    showHydraCloudModal,
    hideHydraCloudModal,
  };
}
