import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./app";
import Catalogue from "./pages/catalogue/catalogue";
import Downloads from "./pages/downloads/downloads";
import LibraryPage from "./pages/library/page";
import Settings from "./pages/settings/settings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="settings" element={<Settings />} />
          <Route path="library" element={<LibraryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
