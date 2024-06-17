import { useCallback } from "react";
import { average } from "color.js";

import { useAppDispatch, useAppSelector } from "./redux";
import {
  clearUserDetails,
  setProfileBackground,
  setUserDetails,
} from "@renderer/features";
import { darkenColor } from "@renderer/helpers";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const { userDetails, profileBackground } = useAppSelector(
    (state) => state.userDetails
  );

  const clearUser = useCallback(async () => {
    dispatch(clearUserDetails());
  }, [dispatch]);

  const signOut = useCallback(async () => {
    clearUser();

    return window.electron.signOut();
  }, [clearUser]);

  const updateUser = useCallback(async () => {
    return window.electron.getMe().then(async (userDetails) => {
      if (userDetails) {
        dispatch(setUserDetails(userDetails));

        if (userDetails.profileImageUrl) {
          const output = await average(userDetails.profileImageUrl, {
            amount: 1,
            format: "hex",
          });

          dispatch(
            setProfileBackground(
              `linear-gradient(135deg, ${darkenColor(output as string, 0.6)}, ${darkenColor(output as string, 0.7)})`
            )
          );
        }
      }
    });
  }, [dispatch]);

  return {
    userDetails,
    updateUser,
    signOut,
    clearUser,
    profileBackground,
  };
}
