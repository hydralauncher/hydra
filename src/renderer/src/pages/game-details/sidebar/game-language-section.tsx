import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./game-language-section.scss";

const normalizeLanguageName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^\p{L}]+/gu, " ")
    .trim();

const getDisplayName = (displayLocale: string, languageCode: string) => {
  try {
    const name = new Intl.DisplayNames([displayLocale], {
      type: "language",
      languageDisplay: "standard",
    }).of(languageCode);
    return name ? normalizeLanguageName(name) : null;
  } catch {
    return null;
  }
};

const findCurrentLanguageIndex = (languageNames: string[], locale: string) => {
  const baseLanguage = locale.split("-")[0];
  const fullNames = new Set(
    [getDisplayName(locale, locale), getDisplayName("en", locale)].filter(
      Boolean
    )
  );
  const baseNames = [
    getDisplayName(locale, baseLanguage),
    getDisplayName("en", baseLanguage),
  ].filter(Boolean) as string[];

  const normalizedNames = languageNames.map(normalizeLanguageName);
  const exactIndex = normalizedNames.findIndex((name) => fullNames.has(name));
  if (exactIndex !== -1) return exactIndex;

  return normalizedNames.findIndex((name) =>
    baseNames.some(
      (baseName) => name === baseName || name.startsWith(`${baseName} `)
    )
  );
};

export function GameLanguageSection() {
  const { t, i18n } = useTranslation("game_details");
  const { shopDetails } = useContext(gameDetailsContext);

  const languages = useMemo(() => {
    const supportedLanguages = shopDetails?.supported_languages;
    if (!supportedLanguages) return [];

    const languagesString = supportedLanguages.split("<br>")[0];
    const languageArray = languagesString?.split(",") || [];

    const parsedLanguages = languageArray.map((lang) => ({
      language: lang.replace("<strong>*</strong>", "").trim(),
      hasAudio: lang.includes("*"),
    }));

    const currentIndex = findCurrentLanguageIndex(
      parsedLanguages.map(({ language }) => language),
      i18n.language
    );
    if (currentIndex <= 0) return parsedLanguages;

    return [
      parsedLanguages[currentIndex],
      ...parsedLanguages.filter((_, index) => index !== currentIndex),
    ];
  }, [shopDetails?.supported_languages, i18n.language]);

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
                {lang.hasAudio && (
                  <CheckIcon
                    size={14}
                    className="game-language-section__check"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SidebarSection>
  );
}
