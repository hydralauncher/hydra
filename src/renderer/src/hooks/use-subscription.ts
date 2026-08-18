import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setMedusaCloudModalVisible,
  setMedusaCloudModalHidden,
} from "@renderer/features";
import { MedusaCloudFeature } from "@types";

export function useSubscription() {
  const dispatch = useAppDispatch();

  const { isMedusaCloudModalVisible, feature } = useAppSelector(
    (state) => state.subscription
  );

  const showMedusaCloudModal = useCallback(
    (feature: MedusaCloudFeature) => {
      dispatch(setMedusaCloudModalVisible(feature));
    },
    [dispatch]
  );

  const hideMedusaCloudModal = useCallback(() => {
    dispatch(setMedusaCloudModalHidden());
  }, [dispatch]);

  return {
    isMedusaCloudModalVisible,
    medusaCloudFeature: feature,
    showMedusaCloudModal,
    hideMedusaCloudModal,
  };
}
