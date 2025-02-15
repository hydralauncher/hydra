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

import { App } from "./app";

import { store } from "./store";

import resources from "@locales";

import { SuspenseWrapper } from "./components";
import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";

const Home = React.lazy(() => import("./pages/home/home"));
const GameDetails = React.lazy(
  () => import("./pages/game-details/game-details")
);
const Downloads = React.lazy(() => import("./pages/downloads/downloads"));
const Settings = React.lazy(() => import("./pages/settings/settings"));
const Catalogue = React.lazy(() => import("./pages/catalogue/catalogue"));
const Profile = React.lazy(() => import("./pages/profile/profile"));
const Achievements = React.lazy(
  () => import("./pages/achievements/achievements")
);
const ThemeEditor = React.lazy(
  () => import("./pages/theme-editor/theme-editor")
);

import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.RENDERER_VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  release: await window.electron.getVersion(),
});

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
            <Route path="/" element={<SuspenseWrapper Component={Home} />} />
            <Route
              path="/catalogue"
              element={<SuspenseWrapper Component={Catalogue} />}
            />
            <Route
              path="/downloads"
              element={<SuspenseWrapper Component={Downloads} />}
            />
            <Route
              path="/game/:shop/:objectId"
              element={<SuspenseWrapper Component={GameDetails} />}
            />
            <Route
              path="/settings"
              element={<SuspenseWrapper Component={Settings} />}
            />
            <Route
              path="/profile/:userId"
              element={<SuspenseWrapper Component={Profile} />}
            />
            <Route
              path="/achievements"
              element={<SuspenseWrapper Component={Achievements} />}
            />
          </Route>

          <Route
            path="/theme-editor"
            element={<SuspenseWrapper Component={ThemeEditor} />}
          />
        </Routes>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
