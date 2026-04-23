import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./app";
import Catalogue from "./pages/catalogue/catalogue";
import Downloads from "./pages/downloads/downloads";
import LibraryPage from "./pages/library/page";
import Settings from "./pages/settings/settings";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Big Picture root element was not found.");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="library" replace />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="settings" element={<Settings />} />
          <Route path="library" element={<LibraryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
