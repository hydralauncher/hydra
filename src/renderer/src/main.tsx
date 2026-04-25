import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import { App } from "./app";

import { store } from "./store";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import * as Sentry from "@sentry/react";
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
import GameLauncher from "./pages/game-launcher/game-launcher";
import BigPictureApp from "../../big-picture/src/app";
import BigPictureCatalogue from "../../big-picture/src/pages/catalogue/catalogue";
import BigPictureDownloads from "../../big-picture/src/pages/downloads/downloads";
import BigPictureSettings from "../../big-picture/src/pages/settings/settings";
import BigPictureLibrary from "../../big-picture/src/pages/library/page";
import BigPictureGame from "../../big-picture/src/pages/game/game";

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
  release: "hydra-launcher@" + (await window.electron.getVersion()),
});

const isStaging = await window.electron.isStaging();
addCookieInterceptor(isStaging);

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  })
  .then(async () => {
    const userPreferences = (await levelDBService.get(
      "userPreferences",
      null,
      "json"
    )) as { language?: string } | null;

    if (userPreferences?.language) {
      i18n.changeLanguage(userPreferences.language);
    } else {
      window.electron.updateUserPreferences({ language: i18n.language });
    }

    syncDocumentLanguage(i18n.language);
    i18n.on("languageChanged", syncDocumentLanguage);
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
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

          <Route path="/big-picture" element={<BigPictureApp />}>
            <Route index element={<Navigate to="library" replace />} />
            <Route path="catalogue" element={<BigPictureCatalogue />} />
            <Route path="downloads" element={<BigPictureDownloads />} />
            <Route path="settings" element={<BigPictureSettings />} />
            <Route path="library" element={<BigPictureLibrary />} />
            <Route path="game/:shop/:objectId" element={<BigPictureGame />} />
          </Route>
        </Routes>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
