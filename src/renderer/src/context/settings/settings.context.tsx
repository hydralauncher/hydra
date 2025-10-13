import { createContext, useCallback, useEffect, useState } from "react";

import { setUserPreferences } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import type { UserBlocks, UserPreferences } from "@types";
import { useSearchParams } from "react-router-dom";

export interface SettingsContext {
  updateUserPreferences: (values: Partial<UserPreferences>) => Promise<void>;
  setCurrentCategoryIndex: React.Dispatch<React.SetStateAction<number>>;
  clearSourceUrl: () => void;
  clearTheme: () => void;
  sourceUrl: string | null;
  currentCategoryIndex: number;
  blockedUsers: UserBlocks["blocks"];
  fetchBlockedUsers: () => Promise<void>;
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

export const settingsContext = createContext<SettingsContext>({
  updateUserPreferences: async () => {},
  setCurrentCategoryIndex: () => {},
  clearSourceUrl: () => {},
  clearTheme: () => {},
  sourceUrl: null,
  currentCategoryIndex: 0,
  blockedUsers: [],
  fetchBlockedUsers: async () => {},
  appearance: {
    theme: null,
    authorId: null,
    authorName: null,
  },
});

const { Provider } = settingsContext;
export const { Consumer: SettingsContextConsumer } = settingsContext;

export interface SettingsContextProviderProps {
  children: React.ReactNode;
}

export function SettingsContextProvider({
  children,
}: Readonly<SettingsContextProviderProps>) {
  const dispatch = useAppDispatch();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<{
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  }>({
    theme: null,
    authorId: null,
    authorName: null,
  });
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [blockedUsers, setBlockedUsers] = useState<UserBlocks["blocks"]>([]);

  const [searchParams] = useSearchParams();
  const defaultSourceUrl = searchParams.get("urls");
  const defaultTab = searchParams.get("tab");
  const defaultAppearanceTheme = searchParams.get("theme");
  const defaultAppearanceAuthorId = searchParams.get("authorId");
  const defaultAppearanceAuthorName = searchParams.get("authorName");

  useEffect(() => {
    if (sourceUrl) setCurrentCategoryIndex(2);
  }, [sourceUrl]);

  useEffect(() => {
    if (defaultSourceUrl) {
      setSourceUrl(defaultSourceUrl);
    }
  }, [defaultSourceUrl]);

  useEffect(() => {
    if (defaultTab) {
      const idx = Number(defaultTab);
      if (!Number.isNaN(idx)) setCurrentCategoryIndex(idx);
    }
  }, [defaultTab]);

  useEffect(() => {
    if (appearance.theme) setCurrentCategoryIndex(3);
  }, [appearance.theme]);

  useEffect(() => {
    if (
      defaultAppearanceTheme &&
      defaultAppearanceAuthorId &&
      defaultAppearanceAuthorName
    ) {
      setAppearance({
        theme: defaultAppearanceTheme,
        authorId: defaultAppearanceAuthorId,
        authorName: defaultAppearanceAuthorName,
      });
    }
  }, [
    defaultAppearanceTheme,
    defaultAppearanceAuthorId,
    defaultAppearanceAuthorName,
  ]);

  const clearTheme = useCallback(() => {
    setAppearance({
      theme: null,
      authorId: null,
      authorName: null,
    });
  }, []);

  const fetchBlockedUsers = useCallback(async () => {
    const blockedUsers = await window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => {
        return { blocks: [] };
      });
    setBlockedUsers(blockedUsers.blocks);
  }, []);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const clearSourceUrl = () => setSourceUrl(null);

  const updateUserPreferences = async (values: Partial<UserPreferences>) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      dispatch(setUserPreferences(userPreferences));
    });
  };

  return (
    <Provider
      value={{
        updateUserPreferences,
        setCurrentCategoryIndex,
        clearSourceUrl,
        fetchBlockedUsers,
        clearTheme,
        currentCategoryIndex,
        sourceUrl,
        blockedUsers,
        appearance,
      }}
    >
      {children}
    </Provider>
  );
}
