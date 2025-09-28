import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, XIcon } from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./game-language-section.scss";

export function GameLanguageSection() {
  const { t } = useTranslation("game_details");
  const { shopDetails } = useContext(gameDetailsContext);

  const languages = useMemo(() => {
    const supportedLanguages = shopDetails?.supported_languages;
    if (!supportedLanguages) return [];

    const languagesString = supportedLanguages.split("<br>")[0];
    const languageArray = languagesString?.split(",") || [];

    return languageArray.map((lang) => ({
      language: lang.replace("<strong>*</strong>", "").trim(),
      hasAudio: lang.includes("*"),
    }));
  }, [shopDetails?.supported_languages]);

  if (languages.length === 0) {
    return null;
  }

  return (
    <SidebarSection title={t("language")}>
      <div className="game-language-section">
        <div className="game-language-section__header">
          <div className="game-language-section__header-item">
            <span>{t("language")}</span>
          </div>
          <div className="game-language-section__header-item game-language-section__header-item--center">
            <span>{t("caption")}</span>
          </div>
          <div className="game-language-section__header-item game-language-section__header-item--center">
            <span>{t("audio")}</span>
          </div>
        </div>

        <div className="game-language-section__content">
          {languages.map((lang) => (
            <div key={lang.language} className="game-language-section__row">
              <div
                className="game-language-section__cell game-language-section__cell--language"
                title={lang.language}
              >
                {lang.language}
              </div>
              <div className="game-language-section__cell game-language-section__cell--center">
                <CheckIcon size={14} className="game-language-section__check" />
              </div>
              <div className="game-language-section__cell game-language-section__cell--center">
                {lang.hasAudio ? (
                  <CheckIcon
                    size={14}
                    className="game-language-section__check"
                  />
                ) : (
                  <XIcon size={14} className="game-language-section__cross" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SidebarSection>
  );
}
