import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./app";
import Catalogue from "./pages/catalogue/catalogue";
import ComponentLab from "./pages/component-lab/component-lab";
import Downloads from "./pages/downloads/downloads";
import Game from "./pages/game/game";
import GameAchievements from "./pages/game-achievements/game-achievements";
import Home from "./pages/home/home";
import LibraryPage from "./pages/library/page";
import Profile from "./pages/profile/profile";
import Settings from "./pages/settings/settings";
import { initializeBigPictureI18n } from "./i18n";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Big Picture root element was not found.");
}

await initializeBigPictureI18n();

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Home />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="component-lab" element={<ComponentLab />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="settings" element={<Settings />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="profile/:userId?" element={<Profile />} />
          <Route path="game/:shop/:objectId" element={<Game />} />
          <Route
            path="game/:shop/:objectId/achievements"
            element={<GameAchievements />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
