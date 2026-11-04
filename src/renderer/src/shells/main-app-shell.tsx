import { Provider } from "react-redux";
import { Navigate, Route, Routes } from "react-router-dom";

import { CollectionContextMenuProvider } from "@renderer/context";
import { GameOptionsModalProvider } from "@renderer/context/game-options-modal/game-options-modal.context";
import { AchievementNotificationOverlay } from "@renderer/components/achievements/notification/achievement-notification-overlay";

import { App } from "../app";
import { store } from "../store";
import Catalogue from "../pages/catalogue/catalogue";
import Home from "../pages/home/home";
import Downloads from "../pages/downloads/downloads";
import GameDetails from "../pages/game-details/game-details";
import Settings from "../pages/settings/settings";
import Profile from "../pages/profile/profile";
import Achievements from "../pages/achievements/achievements";
import Library from "../pages/library/library";
import Notifications from "../pages/notifications/notifications";
import Shop from "../pages/shop/shop";
import Leaderboards from "../pages/leaderboards/leaderboards";

export default function MainAppShell() {
  return (
    <Provider store={store}>
      <CollectionContextMenuProvider>
        <GameOptionsModalProvider>
          <AchievementNotificationOverlay />
          <Routes>
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
              <Route path="/shop" element={<Shop />} />
              <Route path="/leaderboards" element={<Leaderboards />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </GameOptionsModalProvider>
      </CollectionContextMenuProvider>
    </Provider>
  );
}
