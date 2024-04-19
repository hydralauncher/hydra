import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import React from "react";
import ReactDOM from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import { createHashRouter, RouterProvider } from "react-router-dom";

import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";

import "@fontsource/fira-mono/400.css";
import "@fontsource/fira-mono/500.css";
import "@fontsource/fira-mono/700.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/700.css";
import "react-loading-skeleton/dist/skeleton.css";

import {
  Catalogue,
  Downloads,
  GameDetails,
  Home,
  PatchNotes,
  SearchResults,
  Settings,
} from "@renderer/pages";
import { App } from "./app";

import { store } from "./store";

import * as resources from "@locales";

if (process.env.SENTRY_DSN) {
  init({ dsn: process.env.SENTRY_DSN }, reactInit);
}

const router = createHashRouter([
  {
    path: "/",
    Component: App,
    children: [
      {
        path: "/",
        Component: Home,
      },
      {
        path: "/catalogue",
        Component: Catalogue,
      },
      {
        path: "/downloads",
        Component: Downloads,
      },
      {
        path: "/game/:shop/:objectID",
        Component: GameDetails,
      },
      {
        path: "/search",
        Component: SearchResults,
      },
      {
        path: "/settings",
        Component: Settings,
      },
      {
        path: "/patch-notes",
        Component: PatchNotes,
      },
    ],
  },
]);

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
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>
);
