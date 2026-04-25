import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import resources from "@locales";
import App from "./app";
import Catalogue from "./pages/catalogue/catalogue";
import Downloads from "./pages/downloads/downloads";
import Game from "./pages/game/game";
import Home from "./pages/home/home";
import LibraryPage from "./pages/library/page";
import Settings from "./pages/settings/settings";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Big Picture root element was not found.");
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Home />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="settings" element={<Settings />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="game/:shop/:objectId" element={<Game />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
