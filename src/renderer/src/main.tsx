import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/fira-mono/400.css";
import "@fontsource/fira-mono/500.css";
import "@fontsource/fira-mono/700.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/700.css";
import "react-loading-skeleton/dist/skeleton.css";

import { App } from "./app";
import {
  Home,
  Downloads,
  GameDetails,
  SearchResults,
  Settings,
  Catalogue,
} from "@renderer/pages";

import { store } from "./store";

import * as resources from "@locales";
import Splash from "./pages/splash/splash";

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
  .then(() => {
    window.electron.updateUserPreferences({ language: i18n.language });
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
        <Routes>
          <Route path="/splash" Component={Splash} />
          <Route element={<App />}>
            <Route path="/" Component={Home} />
            <Route path="/catalogue" Component={Catalogue} />
            <Route path="/downloads" Component={Downloads} />
            <Route path="/game/:shop/:objectID" Component={GameDetails} />
            <Route path="/search" Component={SearchResults} />
            <Route path="/settings" Component={Settings} />
          </Route>
        </Routes>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
