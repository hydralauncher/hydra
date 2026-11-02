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
// Global document styles (root height, box-sizing, scrollbars) that every
// window relies on, including the lazily loaded Big Picture and popup windows.
import "./app.scss";

import { CollectionContextMenuProvider } from "@renderer/context";
import { GameOptionsModalProvider } from "@renderer/context/game-options-modal/game-options-modal.context";

import { store } from "./store";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import { clearStateFromPreviousSession } from "./session-state";
import * as Sentry from "@sentry/react";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { levelDBService } from "./services/leveldb.service";
import { AchievementNotificationOverlay } from "./components/achievements/notification/achievement-notification-overlay";
import { lazyPage, preloadPagesWhenIdle } from "./helpers/lazy-page";

const App = React.lazy(() =>
  import("./app").then((module) => ({
    default: module.App,
  }))
);
const Catalogue = lazyPage(() => import("./pages/catalogue/catalogue"));
const Home = lazyPage(() => import("./pages/home/home"));
const Downloads = lazyPage(() => import("./pages/downloads/downloads"));
const GameDetails = lazyPage(() => import("./pages/game-details/game-details"));
const Settings = lazyPage(() => import("./pages/settings/settings"));
const Profile = lazyPage(() => import("./pages/profile/profile"));
const Achievements = lazyPage(
  () => import("./pages/achievements/achievements")
);
const ThemeEditor = lazyPage(() => import("./pages/theme-editor/theme-editor"));
const Library = lazyPage(() => import("./pages/library/library"));
const Notifications = lazyPage(
  () => import("./pages/notifications/notifications")
);
const Shop = lazyPage(() => import("./pages/shop/shop"));
const Leaderboards = lazyPage(
  () => import("./pages/leaderboards/leaderboards")
);
const GameLauncher = lazyPage(
  () => import("./pages/game-launcher/game-launcher")
);
const FriendsWindow = lazyPage(
  () => import("./pages/friends-window/friends-window")
);
const ChatWindow = lazyPage(() => import("./pages/chat-window/chat-window"));
const AuthWindow = lazyPage(() => import("./pages/auth-window/auth-window"));
const RetroAchievementsConnectionWindow = lazyPage(
  () =>
    import(
      "./pages/retroachievements-connection-window/retroachievements-connection-window"
    )
);
const BigPictureApp = React.lazy(() => import("../../big-picture/src/app"));
const BigPictureCatalogue = lazyPage(
  () => import("../../big-picture/src/pages/catalogue/catalogue")
);
const BigPictureComponentLab = lazyPage(
  () => import("../../big-picture/src/pages/component-lab/component-lab")
);
const BigPictureDownloads = lazyPage(
  () => import("../../big-picture/src/pages/downloads/downloads")
);
const BigPictureHome = lazyPage(
  () => import("../../big-picture/src/pages/home/home")
);
const BigPictureSettings = lazyPage(
  () => import("../../big-picture/src/pages/settings/settings")
);
const BigPictureLibrary = lazyPage(
  () => import("../../big-picture/src/pages/library/page")
);
const BigPictureGame = lazyPage(
  () => import("../../big-picture/src/pages/game/game")
);
const BigPictureGameAchievements = lazyPage(
  () =>
    import("../../big-picture/src/pages/game-achievements/game-achievements")
);
const BigPictureProfile = lazyPage(
  () => import("../../big-picture/src/pages/profile/profile")
);
const AchievementNotification = React.lazy(() =>
  import("./pages/achievements/notification/achievement-notification").then(
    (module) => ({
      default: module.AchievementNotification,
    })
  )
);

const mainWindowPages = [
  Home,
  Catalogue,
  Library,
  Downloads,
  GameDetails,
  Settings,
  Profile,
  Achievements,
  Notifications,
  Shop,
  Leaderboards,
];
const bigPicturePages = [
  BigPictureHome,
  BigPictureLibrary,
  BigPictureGame,
  BigPictureCatalogue,
  BigPictureDownloads,
  BigPictureSettings,
  BigPictureProfile,
  BigPictureGameAchievements,
];
const mainWindowRoutePattern =
  /^#\/(catalogue|library|downloads|game|settings|profile|achievements|notifications|shop|leaderboards)?(\/|$|\?)/;

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

await i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
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
              <React.Suspense fallback={null}>
                <Routes>
                  <Route element={<App />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/catalogue" element={<Catalogue />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route
                      path="/game/:shop/:objectId"
                      element={<GameDetails />}
                    />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/profile/:userId" element={<Profile />} />
                    <Route path="/achievements" element={<Achievements />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/shop" element={<Shop />} />
                    <Route path="/leaderboards" element={<Leaderboards />} />
                  </Route>

                  <Route path="/theme-editor" element={<ThemeEditor />} />
                  <Route
                    path="/achievement-notification"
                    element={<AchievementNotification />}
                  />
                  <Route path="/game-launcher" element={<GameLauncher />} />
                  <Route path="/friends-window" element={<FriendsWindow />} />
                  <Route path="/chat-window" element={<ChatWindow />} />
                  <Route path="/auth-window" element={<AuthWindow />} />
                  <Route
                    path="/retroachievements-connection"
                    element={<RetroAchievementsConnectionWindow />}
                  />

                  <Route path="/big-picture" element={<BigPictureApp />}>
                    <Route index element={<BigPictureHome />} />
                    <Route path="catalogue" element={<BigPictureCatalogue />} />
                    <Route
                      path="component-lab"
                      element={<BigPictureComponentLab />}
                    />
                    <Route path="downloads" element={<BigPictureDownloads />} />
                    <Route path="settings" element={<BigPictureSettings />} />
                    <Route path="library" element={<BigPictureLibrary />} />
                    <Route
                      path="profile/:userId?"
                      element={<BigPictureProfile />}
                    />
                    <Route
                      path="game/:shop/:objectId"
                      element={<BigPictureGame />}
                    />
                    <Route
                      path="game/:shop/:objectId/achievements"
                      element={<BigPictureGameAchievements />}
                    />
                  </Route>
                </Routes>
              </React.Suspense>
            </GameOptionsModalProvider>
          </CollectionContextMenuProvider>
        </HashRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);

if (location.hash.startsWith("#/big-picture")) {
  preloadPagesWhenIdle(bigPicturePages);
} else if (location.hash === "" || mainWindowRoutePattern.test(location.hash)) {
  preloadPagesWhenIdle(mainWindowPages);
}
