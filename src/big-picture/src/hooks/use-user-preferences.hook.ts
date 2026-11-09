import type { UserPreferences } from "@types";
import { useSyncExternalStore } from "react";

type ElectronPreferencesBridge = {
  getUserPreferences?: () => Promise<UserPreferences | null>;
  onUserPreferencesUpdated?: (
    cb: (preferences: UserPreferences | null) => void
  ) => () => void;
};

let lastKnownPreferences: UserPreferences | null = null;
let loadGeneration = 0;
let unsubscribeFromBridge: (() => void) | null = null;
const listeners = new Set<() => void>();

const getBridge = () => globalThis.window.electron as ElectronPreferencesBridge;

const applyPreferences = (preferences: UserPreferences | null) => {
  lastKnownPreferences = preferences;
  for (const listener of listeners) listener();
};

const loadPreferences = async () => {
  const electron = getBridge();
  const generation = ++loadGeneration;

  if (typeof electron.getUserPreferences !== "function") {
    applyPreferences(null);
    return;
  }

  let preferences: UserPreferences | null = null;
  try {
    preferences = await electron.getUserPreferences();
  } catch {
    preferences = null;
  }
  if (generation === loadGeneration) applyPreferences(preferences);
};

const connectBridge = () => {
  const electron = getBridge();
  unsubscribeFromBridge =
    typeof electron.onUserPreferencesUpdated === "function"
      ? electron.onUserPreferencesUpdated((preferences) => {
          loadGeneration += 1;
          applyPreferences(preferences);
        })
      : () => {};
  void loadPreferences();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!unsubscribeFromBridge) connectBridge();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !unsubscribeFromBridge) return;
    unsubscribeFromBridge();
    unsubscribeFromBridge = null;
  };
};

const getSnapshot = () => lastKnownPreferences;

export function useUserPreferences() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
