import { useEffect } from "react";
import { Provider } from "react-redux";
import { Navigate, Route, Routes } from "react-router-dom";

import type { UserPreferences } from "@types";
import { setUserPreferences } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { AchievementNotificationOverlay } from "@renderer/components/achievements/notification/achievement-notification-overlay";

import BigPictureApp from "../../../big-picture/src/app";
import BigPictureCatalogue from "../../../big-picture/src/pages/catalogue/catalogue";
import BigPictureComponentLab from "../../../big-picture/src/pages/component-lab/component-lab";
import BigPictureDownloads from "../../../big-picture/src/pages/downloads/downloads";
import BigPictureHome from "../../../big-picture/src/pages/home/home";
import BigPictureSettings from "../../../big-picture/src/pages/settings/settings";
import BigPictureLibrary from "../../../big-picture/src/pages/library/page";
import BigPictureGame from "../../../big-picture/src/pages/game/game";
import BigPictureGameAchievements from "../../../big-picture/src/pages/game-achievements/game-achievements";
import BigPictureProfile from "../../../big-picture/src/pages/profile/profile";
import { store } from "../store";

function StoreHydrator() {
  useEffect(() => {
    levelDBService
      .get("userPreferences", null, "json")
      .then((preferences) => {
        store.dispatch(
          setUserPreferences(preferences as UserPreferences | null)
        );
      })
      .catch(() => {});
  }, []);

  return null;
}

export default function BigPictureShell() {
  return (
    <Provider store={store}>
      <StoreHydrator />
      <AchievementNotificationOverlay />
      <Routes>
        <Route path="/" element={<BigPictureApp />}>
          <Route index element={<BigPictureHome />} />
          <Route path="catalogue" element={<BigPictureCatalogue />} />
          <Route path="component-lab" element={<BigPictureComponentLab />} />
          <Route path="downloads" element={<BigPictureDownloads />} />
          <Route path="settings" element={<BigPictureSettings />} />
          <Route path="library" element={<BigPictureLibrary />} />
          <Route path="profile/:userId?" element={<BigPictureProfile />} />
          <Route path="game/:shop/:objectId" element={<BigPictureGame />} />
          <Route
            path="game/:shop/:objectId/achievements"
            element={<BigPictureGameAchievements />}
          />
          <Route path="*" element={<Navigate to="/big-picture" replace />} />
        </Route>
      </Routes>
    </Provider>
  );
}
