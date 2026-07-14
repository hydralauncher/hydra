import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import { App } from "./app";

import { store } from "./store";

import resources from "@locales";

import { resolveLanguageKey, SPANISH_LAT_KEY } from "@shared";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import * as Sentry from "@sentry/react";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { levelDBService } from "./services/leveldb.service";
import Catalogue from "./pages/catalogue/catalogue";
import Home from "./pages/home/home";
import Downloads from "./pages/downloads/downloads";
import GameDetails from "./pages/game-details/game-details";
import Settings from "./pages/settings/settings";
import Profile from "./pages/profile/profile";
import Achievements from "./pages/achievements/achievements";
import ThemeEditor from "./pages/theme-editor/theme-editor";
import Library from "./pages/library/library";
import Notifications from "./pages/notifications/notifications";
import { AchievementNotification } from "./pages/achievements/notification/achievement-notification";
import { AchievementNotificationOverlay } from "./components/achievements/notification/achievement-notification-overlay";
import GameLauncher from "./pages/game-launcher/game-launcher";
import FriendsWindow from "./pages/friends-window/friends-window";
import AuthWindow from "./pages/auth-window/auth-window";
import BigPictureApp from "../../big-picture/src/app";
import BigPictureCatalogue from "../../big-picture/src/pages/catalogue/catalogue";
import BigPictureComponentLab from "../../big-picture/src/pages/component-lab/component-lab";
import BigPictureDownloads from "../../big-picture/src/pages/downloads/downloads";
import BigPictureHome from "../../big-picture/src/pages/home/home";
import BigPictureSettings from "../../big-picture/src/pages/settings/settings";
import BigPictureLibrary from "../../big-picture/src/pages/library/page";
import BigPictureGame from "../../big-picture/src/pages/game/game";
import BigPictureGameAchievements from "../../big-picture/src/pages/game-achievements/game-achievements";
import BigPictureProfile from "../../big-picture/src/pages/profile/profile";

console.log = logger.log;

Sentry.init({
  dsn: import.meta.env.RENDERER_VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 0.5,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  release: "hydra-launcher@" + (await globalThis.electron.getVersion()),
});

const isStaging = await globalThis.electron.isStaging();
addCookieInterceptor(isStaging);

window.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled rejection", event.reason);
});

window.addEventListener("error", (event) => {
  logger.error("Uncaught error", event.error ?? event.message);
});

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
};

await i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

const userPreferences = (await levelDBService.get(
  "userPreferences",
  null,
  "json"
)) as { language?: string } | null;

const supportedLanguages = Object.keys(resources);

const needsSpanishLanguageMigration = (storedLanguage: string): boolean => {
  if (storedLanguage === "es") return true;

  const baseLang = storedLanguage.split("-")[0];
  if (baseLang !== "es") return false;

  return !supportedLanguages.includes(storedLanguage);
};

if (userPreferences?.language) {
  if (needsSpanishLanguageMigration(userPreferences.language)) {
    const migratedLanguage = resolveLanguageKey(
      userPreferences.language,
      supportedLanguages
    );
    try {
      await i18n.changeLanguage(migratedLanguage);
      await globalThis.electron.updateUserPreferences({
        language: migratedLanguage,
      });
    } catch (error) {
      console.error("Failed to persist migrated language preference", error);
    }
  } else {
    try {
      await i18n.changeLanguage(userPreferences.language);
    } catch (error) {
      console.error("Failed to change language", error);
      const fallbackLanguage =
        userPreferences.language.split("-")[0] === "es"
          ? SPANISH_LAT_KEY
          : "en";
      await i18n.changeLanguage(fallbackLanguage);
    }
  }
} else {
  const detectedLanguage = resolveLanguageKey(
    i18n.language,
    supportedLanguages
  );
  await i18n.changeLanguage(detectedLanguage);
  globalThis.electron.updateUserPreferences({ language: detectedLanguage });
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

// Every BrowserWindow runs its own renderer with its own i18n instance, so a
// language change must be applied per-window. Subscribe here (the shared entry
// for all routes) so detached windows — friends, game-launcher, etc. — react
// too, not just the routes mounted under <App />.
globalThis.electron.onUserPreferencesUpdated((preferences) => {
  if (!preferences?.language) return;

  const normalizedLanguage = resolveLanguageKey(
    preferences.language,
    supportedLanguages
  );

  if (normalizedLanguage !== i18n.language) {
    i18n.changeLanguage(normalizedLanguage).catch((error) => {
      console.error("Failed to change language", error);
    });
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <HashRouter>
          <AchievementNotificationOverlay />
          <Routes>
            <Route element={<App />}>
              <Route path="/" element={<Home />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/library" element={<Library />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/game/:shop/:objectId" element={<GameDetails />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile/:userId" element={<Profile />} />
              <Route path="/achievements" element={<Achievements />} />
              <Route path="/notifications" element={<Notifications />} />
            </Route>

            <Route path="/theme-editor" element={<ThemeEditor />} />
            <Route
              path="/achievement-notification"
              element={<AchievementNotification />}
            />
            <Route path="/game-launcher" element={<GameLauncher />} />
            <Route path="/friends-window" element={<FriendsWindow />} />
            <Route path="/auth-window" element={<AuthWindow />} />

            <Route path="/big-picture" element={<BigPictureApp />}>
              <Route index element={<BigPictureHome />} />
              <Route path="catalogue" element={<BigPictureCatalogue />} />
              <Route
                path="component-lab"
                element={<BigPictureComponentLab />}
              />
              <Route path="downloads" element={<BigPictureDownloads />} />
              <Route path="settings" element={<BigPictureSettings />} />
              <Route path="library" element={<BigPictureLibrary />} />
              <Route path="profile/:userId?" element={<BigPictureProfile />} />
              <Route path="game/:shop/:objectId" element={<BigPictureGame />} />
              <Route
                path="game/:shop/:objectId/achievements"
                element={<BigPictureGameAchievements />}
              />
            </Route>
          </Routes>
        </HashRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
