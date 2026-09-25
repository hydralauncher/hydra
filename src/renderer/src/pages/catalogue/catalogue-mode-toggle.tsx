import { useTranslation } from "react-i18next";
import cn from "classnames";
import { DeviceDesktopIcon, StackIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setMode, setPcShop } from "@renderer/features";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-games-logo.svg?react";

import "./catalogue-mode-toggle.scss";

export function CatalogueModeToggle() {
  const { t } = useTranslation("catalogue");
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.catalogueSearch.mode);

  const pcShop = useAppSelector((state) => state.catalogueSearch.pcShop);

  return (
    <>
      <div className="catalogue-mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "modern"}
          className={cn("catalogue-mode-toggle__option", {
            "catalogue-mode-toggle__option--active": mode === "modern",
          })}
          onClick={() => dispatch(setMode("modern"))}
        >
          <DeviceDesktopIcon size={14} />
          <span>{t("mode_modern_games")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "classics"}
          className={cn("catalogue-mode-toggle__option", {
            "catalogue-mode-toggle__option--active": mode === "classics",
          })}
          onClick={() => dispatch(setMode("classics"))}
        >
          <ClassicsIcon size={16} />
          <span>{t("mode_classics")}</span>
        </button>
      </div>
      {mode === "modern" && (
        <div
          className="catalogue-mode-toggle"
          role="tablist"
          aria-label="PC store"
        >
          {(["all", "steam", "epic"] as const).map((shop) => (
            <button
              key={shop}
              type="button"
              role="tab"
              aria-selected={pcShop === shop}
              className={cn("catalogue-mode-toggle__option", {
                "catalogue-mode-toggle__option--active": pcShop === shop,
              })}
              onClick={() => dispatch(setPcShop(shop))}
            >
              {shop === "all" && (
                <StackIcon
                  size={14}
                  className="catalogue-mode-toggle__store-icon"
                  aria-hidden="true"
                />
              )}
              {shop === "steam" && (
                <SteamLogo
                  className="catalogue-mode-toggle__store-icon"
                  aria-hidden="true"
                />
              )}
              {shop === "epic" && (
                <EpicLogo
                  className="catalogue-mode-toggle__store-icon"
                  aria-hidden="true"
                />
              )}
              <span>
                {shop === "all"
                  ? t("store_all")
                  : shop === "steam"
                    ? "Steam"
                    : "Epic"}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
