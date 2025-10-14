import { useState, useCallback, useMemo } from "react";
import { useFeature, useAppSelector } from "@renderer/hooks";
import { SettingsTorBox } from "./settings-torbox";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsAllDebrid } from "./settings-all-debrid";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRightIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./settings-debrid.scss";

interface CollapseState {
  torbox: boolean;
  realDebrid: boolean;
  allDebrid: boolean;
}

const sectionVariants = {
  collapsed: {
    opacity: 0,
    y: -20,
    height: 0,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
      opacity: { duration: 0.1 },
      y: { duration: 0.1 },
      height: { duration: 0.2 },
    },
  },
  expanded: {
    opacity: 1,
    y: 0,
    height: "auto",
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
      opacity: { duration: 0.2, delay: 0.1 },
      y: { duration: 0.3 },
      height: { duration: 0.3 },
    },
  },
} as const;

const chevronVariants = {
  collapsed: {
    rotate: 0,
    transition: {
      duration: 0.2,
      ease: "easeInOut" as const,
    },
  },
  expanded: {
    rotate: 90,
    transition: {
      duration: 0.2,
      ease: "easeInOut" as const,
    },
  },
} as const;

export function SettingsDebrid() {
  const { t } = useTranslation("settings");
  const { isFeatureEnabled, Feature } = useFeature();
  const isTorBoxEnabled = isFeatureEnabled(Feature.TorBox);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const initialCollapseState = useMemo<CollapseState>(() => {
    return {
      torbox: !userPreferences?.torBoxApiToken,
      realDebrid: !userPreferences?.realDebridApiToken,
      allDebrid: !userPreferences?.allDebridApiKey,
    };
  }, [userPreferences]);

  const [collapseState, setCollapseState] =
    useState<CollapseState>(initialCollapseState);

  const toggleSection = useCallback((section: keyof CollapseState) => {
    setCollapseState((prevState) => ({
      ...prevState,
      [section]: !prevState[section],
    }));
  }, []);

  return (
    <div className="settings-debrid">
      <p className="settings-debrid__description">{t("debrid_description")}</p>

      <div className="settings-debrid__section">
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={() => toggleSection("realDebrid")}
            aria-label={
              collapseState.realDebrid
                ? "Expand Real-Debrid section"
                : "Collapse Real-Debrid section"
            }
          >
            <motion.div
              variants={chevronVariants}
              animate={collapseState.realDebrid ? "collapsed" : "expanded"}
            >
              <ChevronRightIcon size={16} />
            </motion.div>
          </button>
          <h3 className="settings-debrid__section-title">Real-Debrid</h3>
          {userPreferences?.realDebridApiToken && (
            <CheckCircleFillIcon
              size={16}
              className="settings-debrid__check-icon"
            />
          )}
        </div>

        <AnimatePresence initial={true} mode="wait">
          {!collapseState.realDebrid && (
            <motion.div
              key="realdebrid-content"
              variants={sectionVariants}
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              layout
            >
              <SettingsRealDebrid />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isTorBoxEnabled && (
        <div className="settings-debrid__section">
          <div className="settings-debrid__section-header">
            <button
              type="button"
              className="settings-debrid__collapse-button"
              onClick={() => toggleSection("torbox")}
              aria-label={
                collapseState.torbox
                  ? "Expand TorBox section"
                  : "Collapse TorBox section"
              }
            >
              <motion.div
                variants={chevronVariants}
                animate={collapseState.torbox ? "collapsed" : "expanded"}
              >
                <ChevronRightIcon size={16} />
              </motion.div>
            </button>
            <h3 className="settings-debrid__section-title">TorBox</h3>
            {userPreferences?.torBoxApiToken && (
              <CheckCircleFillIcon
                size={16}
                className="settings-debrid__check-icon"
              />
            )}
          </div>

          <AnimatePresence initial={true} mode="wait">
            {!collapseState.torbox && (
              <motion.div
                key="torbox-content"
                variants={sectionVariants}
                initial="collapsed"
                animate="expanded"
                exit="collapsed"
                layout
              >
                <SettingsTorBox />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="settings-debrid__section">
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={() => toggleSection("allDebrid")}
            aria-label={
              collapseState.allDebrid
                ? "Expand All-Debrid section"
                : "Collapse All-Debrid section"
            }
          >
            <motion.div
              variants={chevronVariants}
              animate={collapseState.allDebrid ? "collapsed" : "expanded"}
            >
              <ChevronRightIcon size={16} />
            </motion.div>
          </button>
          <h3 className="settings-debrid__section-title">All-Debrid</h3>
          <span className="settings-debrid__beta-badge">BETA</span>
          {userPreferences?.allDebridApiKey && (
            <CheckCircleFillIcon
              size={16}
              className="settings-debrid__check-icon"
            />
          )}
        </div>

        <AnimatePresence initial={true} mode="wait">
          {!collapseState.allDebrid && (
            <motion.div
              key="alldebrid-content"
              variants={sectionVariants}
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              layout
            >
              <SettingsAllDebrid />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
