import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";
import "./app.scss";

import { CollectionContextMenuProvider } from "@renderer/context";
import { GameOptionsModalProvider } from "@renderer/context/game-options-modal/game-options-modal.context";

import { store } from "./store";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import { clearStateFromPreviousSession } from "./session-state";
import * as Sentry from "@sentry/react";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { BadgeTooltip } from "./components/badge-tooltip/badge-tooltip";
import { levelDBService } from "./services/leveldb.service";
import { AchievementNotificationOverlay } from "./components/achievements/notification/achievement-notification-overlay";

const App = lazy(() =>
  import("./app").then((module) => ({ default: module.App }))
);
const Catalogue = lazy(() => import("./pages/catalogue/catalogue"));
const Home = lazy(() => import("./pages/home/home"));
const Downloads = lazy(() => import("./pages/downloads/downloads"));
const GameDetails = lazy(() => import("./pages/game-details/game-details"));
const Settings = lazy(() => import("./pages/settings/settings"));
const Profile = lazy(() => import("./pages/profile/profile"));
const Achievements = lazy(() => import("./pages/achievements/achievements"));
const ThemeEditor = lazy(() => import("./pages/theme-editor/theme-editor"));
const Library = lazy(() => import("./pages/library/library"));
const Notifications = lazy(() => import("./pages/notifications/notifications"));
const Leaderboards = lazy(() => import("./pages/leaderboards/leaderboards"));
const AchievementNotification = lazy(() =>
  import("./pages/achievements/notification/achievement-notification").then(
    (module) => ({ default: module.AchievementNotification })
  )
);
const GameLauncher = lazy(() => import("./pages/game-launcher/game-launcher"));
const FriendsWindow = lazy(
  () => import("./pages/friends-window/friends-window")
);
const ChatWindow = lazy(() => import("./pages/chat-window/chat-window"));
const AuthWindow = lazy(() => import("./pages/auth-window/auth-window"));
const RetroAchievementsConnectionWindow = lazy(
  () =>
    import(
      "./pages/retroachievements-connection-window/retroachievements-connection-window"
    )
);
const BigPictureApp = lazy(() => import("../../big-picture/src/app"));
const BigPictureCatalogue = lazy(
  () => import("../../big-picture/src/pages/catalogue/catalogue")
);
const BigPictureComponentLab = lazy(
  () => import("../../big-picture/src/pages/component-lab/component-lab")
);
const BigPictureDownloads = lazy(
  () => import("../../big-picture/src/pages/downloads/downloads")
);
const BigPictureHome = lazy(
  () => import("../../big-picture/src/pages/home/home")
);
const BigPictureSettings = lazy(
  () => import("../../big-picture/src/pages/settings/settings")
);
const BigPictureLibrary = lazy(
  () => import("../../big-picture/src/pages/library/page")
);
const BigPictureGame = lazy(
  () => import("../../big-picture/src/pages/game/game")
);
const BigPictureGameAchievements = lazy(
  () =>
    import("../../big-picture/src/pages/game-achievements/game-achievements")
);
const BigPictureProfile = lazy(
  () => import("../../big-picture/src/pages/profile/profile")
);

const page = (Page: React.ComponentType) => (
  <Suspense fallback={null}>
    <Page />
  </Suspense>
);

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

const localeLoaders = import.meta.glob<Record<string, object>>(
  "../../locales/*/translation.json",
  { import: "default" }
);
const localeRequests = new Map<string, Promise<Record<string, object>>>();

const loadLocale = (language: string) => {
  const loader = localeLoaders[`../../locales/${language}/translation.json`];
  if (!loader) return Promise.resolve({});

  let request = localeRequests.get(language);
  if (!request) {
    request = loader();
    localeRequests.set(language, request);
  }
  return request;
};

const localeBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language, namespace, callback) => {
    loadLocale(language)
      .then((bundles) => callback(null, bundles[namespace] ?? {}))
      .catch((error) => callback(error, null));
  },
};

const englishResources = await loadLocale("en");

await i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: englishResources },
    partialBundledLanguages: true,
    ns: Object.keys(englishResources),
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

if (userPreferences?.language) {
  await i18n.changeLanguage(userPreferences.language);
} else {
  await i18n.changeLanguage(i18n.language);
  globalThis.electron.updateUserPreferences({ language: i18n.language });
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

// Every BrowserWindow runs its own renderer with its own i18n instance, so a
// language change must be applied per-window. Subscribe here (the shared entry
// for all routes) so detached windows — friends, game-launcher, etc. — react
// too, not just the routes mounted under <App />.
globalThis.electron.onUserPreferencesUpdated((preferences) => {
  if (preferences?.language && preferences.language !== i18n.language) {
    i18n.changeLanguage(preferences.language).catch((error) => {
      console.error("Failed to change language", error);
    });
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <HashRouter>
          <CollectionContextMenuProvider>
            <GameOptionsModalProvider>
              <AchievementNotificationOverlay />
              <BadgeTooltip />
              <Routes>
                <Route element={page(App)}>
                  <Route path="/" element={page(Home)} />
                  <Route path="/catalogue" element={page(Catalogue)} />
                  <Route path="/library" element={page(Library)} />
                  <Route path="/downloads" element={page(Downloads)} />
                  <Route
                    path="/game/:shop/:objectId"
                    element={page(GameDetails)}
                  />
                  <Route path="/settings" element={page(Settings)} />
                  <Route path="/profile/:userId" element={page(Profile)} />
                  <Route path="/achievements" element={page(Achievements)} />
                  <Route path="/notifications" element={page(Notifications)} />
                  <Route path="/leaderboards" element={page(Leaderboards)} />
                </Route>

                <Route path="/theme-editor" element={page(ThemeEditor)} />
                <Route
                  path="/achievement-notification"
                  element={page(AchievementNotification)}
                />
                <Route path="/game-launcher" element={page(GameLauncher)} />
                <Route path="/friends-window" element={page(FriendsWindow)} />
                <Route path="/chat-window" element={page(ChatWindow)} />
                <Route path="/auth-window" element={page(AuthWindow)} />
                <Route
                  path="/retroachievements-connection"
                  element={page(RetroAchievementsConnectionWindow)}
                />

                <Route path="/big-picture" element={page(BigPictureApp)}>
                  <Route index element={page(BigPictureHome)} />
                  <Route path="catalogue" element={page(BigPictureCatalogue)} />
                  <Route
                    path="component-lab"
                    element={page(BigPictureComponentLab)}
                  />
                  <Route path="downloads" element={page(BigPictureDownloads)} />
                  <Route path="settings" element={page(BigPictureSettings)} />
                  <Route path="library" element={page(BigPictureLibrary)} />
                  <Route
                    path="profile/:userId?"
                    element={page(BigPictureProfile)}
                  />
                  <Route
                    path="game/:shop/:objectId"
                    element={page(BigPictureGame)}
                  />
                  <Route
                    path="game/:shop/:objectId/achievements"
                    element={page(BigPictureGameAchievements)}
                  />
                </Route>
              </Routes>
            </GameOptionsModalProvider>
          </CollectionContextMenuProvider>
        </HashRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
