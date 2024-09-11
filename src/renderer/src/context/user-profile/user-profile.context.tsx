import { darkenColor } from "@renderer/helpers";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { UserProfile } from "@types";
import { average } from "color.js";

import { createContext, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface UserProfileContext {
  userProfile: UserProfile | null;
  heroBackground: string;
  /* Indicates if the current user is viewing their own profile */
  isMe: boolean;
}

export const DEFAULT_USER_PROFILE_BACKGROUND = "#151515B3";

export const userProfileContext = createContext<UserProfileContext>({
  userProfile: null,
  heroBackground: DEFAULT_USER_PROFILE_BACKGROUND,
  isMe: false,
});

const { Provider } = userProfileContext;
export const { Consumer: UserProfileContextConsumer } = userProfileContext;

export interface UserProfileContextProviderProps {
  children: React.ReactNode;
  userId: string;
}

export function UserProfileContextProvider({
  children,
  userId,
}: UserProfileContextProviderProps) {
  const { userDetails } = useAppSelector((state) => state.userDetails);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [heroBackground, setHeroBackground] = useState(
    DEFAULT_USER_PROFILE_BACKGROUND
  );

  const getHeroBackgroundFromImageUrl = async (imageUrl: string) => {
    const output = await average(imageUrl, {
      amount: 1,
      format: "hex",
    });

    return `linear-gradient(135deg, ${darkenColor(output as string, 0.6)}, ${darkenColor(output as string, 0.8, 0.7)})`;
  };

  const { t } = useTranslation("user_profile");

  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const getUserProfile = useCallback(async () => {
    return window.electron.getUser(userId).then((userProfile) => {
      if (userProfile) {
        setUserProfile(userProfile);

        if (userProfile.profileImageUrl) {
          getHeroBackgroundFromImageUrl(userProfile.profileImageUrl).then(
            (color) => setHeroBackground(color)
          );
        }
      } else {
        showErrorToast(t("user_not_found"));
        navigate(-1);
      }
    });
  }, [navigate, showErrorToast, userId, t]);

  useEffect(() => {
    getUserProfile();
  }, [getUserProfile]);

  return (
    <Provider
      value={{
        userProfile,
        heroBackground,
        isMe: userDetails?.id === userProfile?.id,
      }}
    >
      {children}
    </Provider>
  );
}
