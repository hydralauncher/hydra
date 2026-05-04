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
import "sileo/styles.css";

import { App } from "./app";
import { IPCListenerProvider } from "./components/ipc-listener-provider";

import { store } from "./store";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";

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
import Roms from "./pages/roms/roms";
import News from "./pages/news/news";
import NewsArticlePage from "./pages/news/news-article";
import RomPlayer from "./pages/roms/rom-player";
import RomDetail from "./pages/roms/rom-detail";

import BigPictureApp from "./pages/big-picture/big-picture-app";
import BigPictureLibrary from "./pages/big-picture/big-picture-library";
import BigPictureCatalogue from "./pages/big-picture/big-picture-catalogue";
import BigPictureDownloads from "./pages/big-picture/big-picture-downloads";
import BigPictureSettings from "./pages/big-picture/big-picture-settings";
import BigPictureGameDetail from "./pages/big-picture/big-picture-game-detail";

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
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
        <Routes>
          <Route element={<IPCListenerProvider />}>
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
              <Route path="/news" element={<News />} />
              <Route path="/news/article" element={<NewsArticlePage />} />
              <Route path="/roms" element={<Roms />} />
              <Route path="/roms/:id" element={<RomDetail />} />
              <Route path="/roms/play" element={<RomPlayer />} />
            </Route>

            <Route path="/big-picture" element={<BigPictureApp />}>
              <Route index element={<BigPictureLibrary />} />
              <Route path="catalogue" element={<BigPictureCatalogue />} />
              <Route path="downloads" element={<BigPictureDownloads />} />
              <Route path="settings" element={<BigPictureSettings />} />
              <Route
                path="game/:shop/:objectId"
                element={<BigPictureGameDetail />}
              />
            </Route>
          </Route>

          <Route path="/theme-editor" element={<ThemeEditor />} />
          <Route
            path="/achievement-notification"
            element={<AchievementNotification />}
          />
          <Route path="/game-launcher" element={<GameLauncher />} />
        </Routes>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
