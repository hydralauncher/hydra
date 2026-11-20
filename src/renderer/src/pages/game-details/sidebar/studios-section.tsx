import { Fragment, useContext } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { gameDetailsContext } from "@renderer/context";
import { clearFilters, setFilters, setMode } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import {
  buildStudioCatalogueFilter,
  type StudioRole,
} from "./studio-catalogue-filter";

import "./studios-section.scss";

const STUDIO_ROLES: StudioRole[] = ["developers", "publishers"];

export function StudiosSection() {
  const { shop, shopDetails } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const rows = STUDIO_ROLES.map((role) => {
    const names = shopDetails?.[role];
    return {
      role,
      names: Array.isArray(names) ? names.filter((name) => name.trim()) : [],
    };
  }).filter(({ names }) => names.length > 0);

  if (rows.length === 0) return null;

  const openCatalogue = (role: StudioRole, name: string) => {
    const { mode, filters } = buildStudioCatalogueFilter(shop, role, name);

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
              {names.map((name, index) => (
                <Fragment key={name}>
                  {index > 0 && ", "}
                  <button
                    type="button"
                    className="studios-section__link"
                    onClick={() => openCatalogue(role, name)}
                  >
                    {name}
                  </button>
                </Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </SidebarSection>
  );
}
