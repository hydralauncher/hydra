import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import "./app.scss";

import { applyLanguage } from "../../locales/apply-language";
import { loadLocale } from "../../locales/load-locale";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import { clearStateFromPreviousSession } from "./session-state";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { levelDBService } from "./services/leveldb.service";
import * as Sentry from "@sentry/react";

const MainAppShell = lazy(() => import("./shells/main-app-shell"));
const FriendsShell = lazy(() => import("./shells/friends-shell"));

const ThemeEditor = lazy(() => import("./pages/theme-editor/theme-editor"));
const AchievementNotification = lazy(() =>
  import("./pages/achievements/notification/achievement-notification").then(
    (module) => ({ default: module.AchievementNotification })
  )
);
const GameLauncher = lazy(() => import("./pages/game-launcher/game-launcher"));
const ChatWindow = lazy(() => import("./pages/chat-window/chat-window"));
const AuthWindow = lazy(() => import("./pages/auth-window/auth-window"));
const RetroAchievementsConnectionWindow = lazy(
  () =>
    import(
      "./pages/retroachievements-connection-window/retroachievements-connection-window"
    )
);

const BigPictureShell = lazy(() => import("./shells/big-picture-shell"));

console.log = logger.log;

Sentry.init({
  dsn: import.meta.env.RENDERER_VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.5,
  release: "hydra-launcher@" + (await globalThis.electron.getVersion()),
});

globalThis.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled promise rejection", event.reason);
});

globalThis.addEventListener("error", (event) => {
  logger.error("Uncaught error", event.error ?? event.message);
});

const isStaging = await globalThis.electron.isStaging();
addCookieInterceptor(isStaging);

await clearStateFromPreviousSession();

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
};

const userPreferences = (await levelDBService.get(
  "userPreferences",
  null,
  "json"
)) as { language?: string } | null;

const englishLocale = await loadLocale("en");

await i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: englishLocale.resources },
    fallbackLng: "en",
    lng: userPreferences?.language,
    interpolation: {
      escapeValue: false,
    },
  });

const initialLanguage = await applyLanguage(
  userPreferences?.language ?? i18n.language
);

if (!userPreferences?.language) {
  globalThis.electron.updateUserPreferences({ language: initialLanguage });
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

// Every BrowserWindow runs its own renderer with its own i18n instance, so a
// language change must be applied per-window. Subscribe here (the shared entry
// for all routes) so detached windows — friends, game-launcher, etc. — react
// too, not just the routes mounted under <App />.
globalThis.electron.onUserPreferencesUpdated((preferences) => {
  if (preferences?.language && preferences.language !== i18n.language) {
    applyLanguage(preferences.language).catch((error) => {
      console.error("Failed to change language", error);
    });
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/theme-editor" element={<ThemeEditor />} />
            <Route
              path="/achievement-notification"
              element={<AchievementNotification />}
            />
            <Route path="/game-launcher" element={<GameLauncher />} />
            <Route path="/friends-window" element={<FriendsShell />} />
            <Route path="/chat-window" element={<ChatWindow />} />
            <Route path="/auth-window" element={<AuthWindow />} />
            <Route
              path="/retroachievements-connection"
              element={<RetroAchievementsConnectionWindow />}
            />

            <Route path="/big-picture/*" element={<BigPictureShell />} />

            <Route path="*" element={<MainAppShell />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
