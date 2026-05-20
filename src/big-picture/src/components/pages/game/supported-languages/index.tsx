import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { ShopDetails } from "@types";
import { useMemo } from "react";
import { Typography } from "../../../common";

export interface SupportedLanguagesProps {
  shopDetails: ShopDetails;
}

export function SupportedLanguages({
  shopDetails,
}: Readonly<SupportedLanguagesProps>) {
  const languages = useMemo(() => {
    const supportedLanguages = shopDetails.supported_languages;
    if (!supportedLanguages) return [];

    const languagesString = supportedLanguages.split("<br>")[0];
    const languageArray = languagesString?.split(",") || [];

    return languageArray.map((lang) => ({
      language: lang.replace("<strong>*</strong>", "").trim(),
      hasAudio: lang.includes("*"),
    }));
  }, [shopDetails.supported_languages]);

  if (languages.length === 0) {
    return null;
  }

  return (
    <section className="game-page__languages" aria-label="Languages">
      <div className="game-page__languages-title">
        <Typography>Languages</Typography>

        <div className="game-page__languages-labels">
          <Typography className="game-page__languages-label">
            Caption
          </Typography>
          <Typography className="game-page__languages-label">Audio</Typography>
        </div>
      </div>

      {languages.map((lang) => (
        <div key={lang.language} className="game-page__languages-row">
          <Typography className="game-page__languages-cell game-page__languages-cell--language">
            {lang.language}
          </Typography>

          <div className="game-page__languages-cell game-page__languages-cell--center">
            <CheckIcon size={16} weight="bold" />
          </div>

          <div className="game-page__languages-cell game-page__languages-cell--center">
            {lang.hasAudio ? (
              <CheckIcon size={16} weight="bold" />
            ) : (
              <XIcon
                size={16}
                weight="bold"
                className="game-page__languages-cross"
              />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
