import { createContext, useEffect, useState } from "react";
import {
  setUserPreferences,
  setUserClientPreferences,
} from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import type { UserPreferences, client } from "@types";
import { useSearchParams } from "react-router-dom";

export interface SettingsContext {
  updateUserPreferences: (values: Partial<UserPreferences>) => Promise<void>;
  updateUserClientPreferences: (values: client) => Promise<void>;
  setCurrentCategoryIndex: React.Dispatch<React.SetStateAction<number>>;
  clearSourceUrl: () => void;
  sourceUrl: string | null;
  currentCategoryIndex: number;
}

export const settingsContext = createContext<SettingsContext>({
  updateUserPreferences: async () => {},
  updateUserClientPreferences: async () => {},
  setCurrentCategoryIndex: () => {},
  clearSourceUrl: () => {},
  sourceUrl: null,
  currentCategoryIndex: 0,
});

const { Provider } = settingsContext;
export const { Consumer: SettingsContextConsumer } = settingsContext;

export interface SettingsContextProviderProps {
  children: React.ReactNode;
}

export function SettingsContextProvider({
  children,
}: SettingsContextProviderProps) {
  const dispatch = useAppDispatch();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);

  const [searchParams] = useSearchParams();
  const defaultSourceUrl = searchParams.get("urls");

  useEffect(() => {
    if (sourceUrl) setCurrentCategoryIndex(2);
  }, [sourceUrl]);

  useEffect(() => {
    if (defaultSourceUrl) {
      setSourceUrl(defaultSourceUrl);
    }
  }, [defaultSourceUrl]);

  const clearSourceUrl = () => setSourceUrl(null);

  const updateUserPreferences = async (values: Partial<UserPreferences>) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      dispatch(setUserPreferences(userPreferences));
    });
  };

  const updateUserClientPreferences = async (values: client) => {
    await window.electron.updateUserClientPreferences(values);
    window.electron.getUserClientPreferences().then((userClientPreferences) => {
      dispatch(setUserClientPreferences(userClientPreferences));
    });
  };

  return (
    <Provider
      value={{
        updateUserPreferences,
        updateUserClientPreferences,
        setCurrentCategoryIndex,
        clearSourceUrl,
        currentCategoryIndex,
        sourceUrl,
      }}
    >
      {children}
    </Provider>
  );
}
