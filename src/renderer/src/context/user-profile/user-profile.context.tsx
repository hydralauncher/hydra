import { darkenColor } from "@renderer/helpers";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { Badge, UserProfile, UserStats, UserGame } from "@types";
import { average } from "color.js";

import { createContext, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface UserProfileContext {
  userProfile: UserProfile | null;
  heroBackground: string;
  /* Indicates if the current user is viewing their own profile */
  isMe: boolean;
  userStats: UserStats | null;
  getUserProfile: () => Promise<void>;
  getUserLibraryGames: () => Promise<void>;
  setSelectedBackgroundImage: React.Dispatch<React.SetStateAction<string>>;
  backgroundImage: string;
  badges: Badge[];
  libraryGames: UserGame[];
  pinnedGames: UserGame[];
}

export const DEFAULT_USER_PROFILE_BACKGROUND = "#151515B3";

export const userProfileContext = createContext<UserProfileContext>({
  userProfile: null,
  heroBackground: DEFAULT_USER_PROFILE_BACKGROUND,
  isMe: false,
  userStats: null,
  getUserProfile: async () => {},
  getUserLibraryGames: async () => {},
  setSelectedBackgroundImage: () => {},
  backgroundImage: "",
  badges: [],
  libraryGames: [],
  pinnedGames: [],
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
}: Readonly<UserProfileContextProviderProps>) {
  const { userDetails } = useAppSelector((state) => state.userDetails);

  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [libraryGames, setLibraryGames] = useState<UserGame[]>([]);
  const [pinnedGames, setPinnedGames] = useState<UserGame[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [heroBackground, setHeroBackground] = useState(
    DEFAULT_USER_PROFILE_BACKGROUND
  );
  const [selectedBackgroundImage, setSelectedBackgroundImage] = useState("");

  const isMe = userDetails?.id === userProfile?.id;

  const getHeroBackgroundFromImageUrl = async (imageUrl: string) => {
    const output = await average(imageUrl, {
      amount: 1,
      format: "hex",
    });

    return `linear-gradient(135deg, ${darkenColor(output as string, 0.5)}, ${darkenColor(output as string, 0.6, 0.5)})`;
  };

  const getBackgroundImageUrl = () => {
    if (selectedBackgroundImage && isMe)
      return `local:${selectedBackgroundImage}`;
    if (userProfile?.backgroundImageUrl) return userProfile.backgroundImageUrl;

    return "";
  };

  const { t } = useTranslation("user_profile");

  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const getUserStats = useCallback(async () => {
    window.electron.getUserStats(userId).then((stats) => {
      setUserStats(stats);
    });
  }, [userId]);

  const getUserLibraryGames = useCallback(async () => {
    try {
      const response = await window.electron.getUserLibrary(userId);
      if (response) {
        setLibraryGames(response.library);
        setPinnedGames(response.pinnedGames);
      } else {
        setLibraryGames([]);
        setPinnedGames([]);
      }
    } catch (error) {
      setLibraryGames([]);
      setPinnedGames([]);
    }
  }, [userId]);

  const getUserProfile = useCallback(async () => {
    getUserStats();
    getUserLibraryGames();

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
  }, [navigate, getUserStats, getUserLibraryGames, showErrorToast, userId, t]);

  const getBadges = useCallback(async () => {
    const badges = await window.electron.getBadges();
    setBadges(badges);
  }, []);

  useEffect(() => {
    setUserProfile(null);
    setLibraryGames([]);
    setPinnedGames([]);
    setHeroBackground(DEFAULT_USER_PROFILE_BACKGROUND);

    getUserProfile();
    getBadges();
  }, [getUserProfile, getBadges]);

  return (
    <Provider
      value={{
        userProfile,
        heroBackground,
        isMe,
        getUserProfile,
        getUserLibraryGames,
        setSelectedBackgroundImage,
        backgroundImage: getBackgroundImageUrl(),
        userStats,
        badges,
        libraryGames,
        pinnedGames,
      }}
    >
      {children}
    </Provider>
  );
}
