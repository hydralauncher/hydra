import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import * as Sentry from "@sentry/electron/renderer";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";

import { App } from "./app";
import {
  Home,
  Downloads,
  GameDetails,
  SearchResults,
  Settings,
  Catalogue,
  Profile,
} from "@renderer/pages";

import { store } from "./store";

import resources from "@locales";
import { Achievemnt } from "./pages/achievement/achievement";

import "./workers";
import { RepacksContextProvider } from "./context";

Sentry.init({});

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
      <RepacksContextProvider>
        <HashRouter>
          <Routes>
            <Route element={<App />}>
              <Route path="/" Component={Home} />
              <Route path="/catalogue" Component={Catalogue} />
              <Route path="/downloads" Component={Downloads} />
              <Route path="/game/:shop/:objectID" Component={GameDetails} />
              <Route path="/search" Component={SearchResults} />
              <Route path="/settings" Component={Settings} />
              <Route path="/profile/:userId" Component={Profile} />
            </Route>
            <Route path="/achievement-notification" Component={Achievemnt} />
          </Routes>
        </HashRouter>
      </RepacksContextProvider>
    </Provider>
  </React.StrictMode>
);
