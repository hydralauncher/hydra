import { useCallback } from "react";
import { average } from "color.js";

import { useAppDispatch, useAppSelector } from "./redux";
import { setProfileBackground, setUserDetails } from "@renderer/features";
import { darkenColor } from "@renderer/helpers";
import { UserDetails } from "@types";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const { userDetails, profileBackground } = useAppSelector(
    (state) => state.userDetails
  );

  const clearUserDetails = useCallback(async () => {
    dispatch(setUserDetails(null));
    dispatch(setProfileBackground(null));

    window.localStorage.removeItem("userDetails");
  }, [dispatch]);

  const signOut = useCallback(async () => {
    clearUserDetails();

    return window.electron.signOut();
  }, [clearUserDetails]);

  const updateUserDetails = useCallback(
    async (userDetails: UserDetails) => {
      dispatch(setUserDetails(userDetails));

      if (userDetails.profileImageUrl) {
        const output = await average(userDetails.profileImageUrl, {
          amount: 1,
          format: "hex",
        });

        const profileBackground = `linear-gradient(135deg, ${darkenColor(output as string, 0.6)}, ${darkenColor(output as string, 0.8, 0.7)})`;
        dispatch(setProfileBackground(profileBackground));

        window.localStorage.setItem(
          "userDetails",
          JSON.stringify({ ...userDetails, profileBackground })
        );
      } else {
        const profileBackground = `#151515B3`;
        dispatch(setProfileBackground(profileBackground));

        window.localStorage.setItem(
          "userDetails",
          JSON.stringify({ ...userDetails, profileBackground })
        );
      }
    },
    [dispatch]
  );

  const fetchUserDetails = useCallback(async () => {
    return window.electron.getMe().then((userDetails) => {
      if (userDetails == null) {
        clearUserDetails();
      }

      return userDetails;
    });
  }, [clearUserDetails]);

  const patchUser = useCallback(
    async (displayName: string, imageProfileUrl: string | null) => {
      const response = await window.electron.updateProfile(
        displayName,
        imageProfileUrl
      );

      return updateUserDetails(response);
    },
    [updateUserDetails]
  );

  return {
    userDetails,
    fetchUserDetails,
    signOut,
    clearUserDetails,
    updateUserDetails,
    patchUser,
    profileBackground,
  };
}
