import { darkenColor } from "@renderer/helpers";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { Badge, UserProfile, UserStats, UserGame, ProfileAchievement } from "@types";
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
  getUserLibraryGames: (sortBy?: string) => Promise<void>;
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
  getUserLibraryGames: async (_sortBy?: string) => {},
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
    const output = await average(imageUrl, { amount: 1, format: "hex" });

    return `linear-gradient(135deg, ${darkenColor(output as string, 0.5)}, ${darkenColor(output as string, 0.6, 0.5)})`;
  };

  const getBackgroundImageUrl = () => {
    if (selectedBackgroundImage && isMe)
      return `local:${selectedBackgroundImage}`;
    if (userProfile?.backgroundImageUrl) return userProfile.backgroundImageUrl;

    return "";
  };

  const { t, i18n } = useTranslation("user_profile");

  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const getUserStats = useCallback(async () => {
    window.electron.hydraApi
      .get<UserStats>(`/users/${userId}/stats`)
      .then((stats) => {
        setUserStats(stats);
      });
  }, [userId]);

  const getUserLibraryGames = useCallback(
    async (sortBy?: string) => {
      try {
        const params = new URLSearchParams();
        params.append("take", "12");
        params.append("skip", "0");
        if (sortBy) {
          params.append("sortBy", sortBy);
        }

        const queryString = params.toString();
        const url = queryString
          ? `/users/${userId}/library?${queryString}`
          : `/users/${userId}/library`;

        const response = await window.electron.hydraApi.get<{
          library: UserGame[];
          pinnedGames: UserGame[];
        }>(url);

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
    },
    [userId]
  );

  const getUserProfile = useCallback(async () => {
    getUserStats();
    getUserLibraryGames();

    const currentLanguage = i18n.language.split("-")[0];
    const supportedLanguages = ["pt", "ru", "es"];
    const language = supportedLanguages.includes(currentLanguage)
      ? currentLanguage
      : "en";

    const params = new URLSearchParams({ language });

    // Fetch main profile data
    const profilePromise = window.electron.hydraApi
      .get<UserProfile>(`/users/${userId}?${params.toString()}`)
      .catch(() => {
        showErrorToast(t("user_not_found"));
        navigate(-1);
        throw new Error("Profile not found");
      });

    // Fetch achievements separately
    const achievementsPromise = window.electron.hydraApi
      .get<ProfileAchievement[]>(`/users/${userId}/achievements?${params.toString()}`)
      .catch(() => null); // If achievements fail, just return null

    return Promise.all([profilePromise, achievementsPromise])
      .then(([userProfile, achievements]) => {
        // Merge achievements into the profile
        const profileWithAchievements = {
          ...userProfile,
          achievements: achievements || null,
        };
        
        setUserProfile(profileWithAchievements);

        if (userProfile.profileImageUrl) {
          getHeroBackgroundFromImageUrl(userProfile.profileImageUrl).then(
            (color) => setHeroBackground(color)
          );
        }
      });
  }, [
    navigate,
    getUserStats,
    getUserLibraryGames,
    showErrorToast,
    userId,
    t,
    i18n,
  ]);

  const getBadges = useCallback(async () => {
    const language = i18n.language.split("-")[0];
    const params = new URLSearchParams({ locale: language });

    const badges = await window.electron.hydraApi.get<Badge[]>(
      `/badges?${params.toString()}`,
      { needsAuth: false }
    );
    setBadges(badges);
  }, [i18n]);

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
