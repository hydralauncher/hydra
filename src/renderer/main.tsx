import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { createHashRouter, RouterProvider } from "react-router-dom";

import * as Sentry from "@sentry/react";

import "@fontsource/fira-mono/400.css";
import "@fontsource/fira-mono/500.css";
import "@fontsource/fira-mono/700.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/700.css";
import "react-loading-skeleton/dist/skeleton.css";

import { App } from "./app";
import {
  Catalogue,
  Downloads,
  GameDetails,
  SearchResults,
  Settings,
} from "@renderer/pages";

import { store } from "./store";

import * as resources from "@locales";

if (process.env.SENTRY_RENDERER_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_RENDERER_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
    // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
    tracePropagationTargets: ["localhost"],
    // Session Replay
    replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
    replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
  });
}

const router = createHashRouter([
  {
    path: "/",
    Component: App,
    children: [
      {
        path: "/",
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
