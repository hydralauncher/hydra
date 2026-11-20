import { useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { gameDetailsContext } from "@renderer/context";
import { clearFilters, setFilters, setMode } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import {
  buildStudioCatalogueFilter,
  getStudioNames,
  type StudioRole,
} from "./studio-catalogue-filter";

import "./studios-section.scss";

const STUDIO_ROLES: StudioRole[] = ["developers", "publishers"];
const NAMES_LOOKUP_TIMEOUT_MS = 2500;

export function StudiosSection() {
  const { shop, shopDetails } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const lastClickRef = useRef(0);

  // Leaving or switching the game drops a names lookup still in flight.
  useEffect(
    () => () => {
      lastClickRef.current += 1;
    },
    [shopDetails]
  );

  const rows = STUDIO_ROLES.map((role) => ({
    role,
    names: getStudioNames(shopDetails?.[role]),
  })).filter(({ names }) => names.length > 0);

  if (rows.length === 0) return null;

  const openCatalogue = async (role: StudioRole, name: string) => {
    const click = ++lastClickRef.current;

    // The main process caches the list for 24h; a cold cache downloads it.
    // Without the list, the filter falls back to the exact name.
    const catalogueNames =
      shop === "launchbox"
        ? []
        : await Promise.race([
            window.electron.getCatalogueNames(role).catch(() => []),
            new Promise<string[]>((resolve) =>
              setTimeout(() => resolve([]), NAMES_LOOKUP_TIMEOUT_MS)
            ),
          ]);

    if (click !== lastClickRef.current) return;

    const { mode, filters } = buildStudioCatalogueFilter(
      shop,
      role,
      name,
      catalogueNames
    );

    dispatch(clearFilters());
    dispatch(setMode(mode));
    dispatch(setFilters(filters));
    navigate("/catalogue");
  };

  return (
    <SidebarSection title={t("studios")}>
      <div className="studios-section">
        {rows.map(({ role, names }) => (
          <div key={role} className="studios-section__row">
            <span className="studios-section__label">
              {t(`studio_${role}`, { count: names.length })}
            </span>

            <span className="studios-section__value">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="studios-section__link"
                  onClick={() => openCatalogue(role, name)}
                >
                  {name}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </SidebarSection>
  );
}
