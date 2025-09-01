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

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import Catalogue from "./pages/catalogue/catalogue";
import Home from "./pages/home/home";
import Downloads from "./pages/downloads/downloads";
import GameDetails from "./pages/game-details/game-details";
import Settings from "./pages/settings/settings";
import Profile from "./pages/profile/profile";
import Achievements from "./pages/achievements/achievements";
import ThemeEditor from "./pages/theme-editor/theme-editor";
import { AchievementNotification } from "./pages/achievements/notification/achievement-notification";

console.log = logger.log;

const isStaging = await window.electron.isStaging();
addCookieInterceptor(isStaging);

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
    const userPreferences = await window.electron.getUserPreferences();

    if (userPreferences?.language) {
      i18n.changeLanguage(userPreferences.language);
    } else {
      window.electron.updateUserPreferences({ language: i18n.language });
    }
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<Home />} />
            <Route path="/catalogue" element={<Catalogue />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/game/:shop/:objectId" element={<GameDetails />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile/:userId" element={<Profile />} />
            <Route path="/achievements" element={<Achievements />} />
          </Route>

          <Route path="/theme-editor" element={<ThemeEditor />} />
          <Route
            path="/achievement-notification"
            element={<AchievementNotification />}
          />
        </Routes>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
