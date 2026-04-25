import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { ShopDetails } from "@types";
import { useMemo } from "react";
import { FocusOverrides } from "src/big-picture/src/services/navigation.service";
import { Box, FocusItem, Typography } from "../../../common";
import {
  GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
  GAME_REVIEWS_PRIMARY_FILTER_BUTTON_ID,
  GAME_SUPPORTED_LANGUAGES_LAST_ROW_ID,
  GAME_SUPPORTED_LANGUAGES_TITLE_ID,
} from "../navigation";

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

  const supportedLanguagesNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
    },
    down: {
      type: "item",
      itemId: GAME_SUPPORTED_LANGUAGES_LAST_ROW_ID,
    },
    left: {
      type: "block",
    },
    right: {
      type: "block",
    },
  };

  const lastRowNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_SUPPORTED_LANGUAGES_TITLE_ID,
    },
    left: {
      type: "block",
    },
    right: {
      type: "block",
    },
    down: {
      type: "item",
      itemId: GAME_REVIEWS_PRIMARY_FILTER_BUTTON_ID,
    },
  };

  const renderRow = (
    lang: { language: string; hasAudio: boolean },
    index: number
  ) => {
    const row = (
      <div key={lang.language} className="game-page__languages-row">
        <Typography className="game-page__languages-cell game-page__languages-cell--language">
          {lang.language}
        </Typography>
        <div className="game-page__languages-cell game-page__languages-cell--center">
          <CheckIcon size={14} weight="bold" />
        </div>
        <div className="game-page__languages-cell game-page__languages-cell--center">
          {lang.hasAudio ? (
            <CheckIcon size={14} weight="bold" />
          ) : (
            <XIcon
              size={14}
              weight="bold"
              className="game-page__languages-cross"
            />
          )}
        </div>
      </div>
    );

    if (index === languages.length - 1) {
      return (
        <FocusItem
          key={lang.language}
          id={GAME_SUPPORTED_LANGUAGES_LAST_ROW_ID}
          navigationOverrides={lastRowNavigationOverrides}
          asChild
        >
          {row}
        </FocusItem>
      );
    }

    return row;
  };

  return (
    <div className="game-page__box-group">
      <FocusItem
        id={GAME_SUPPORTED_LANGUAGES_TITLE_ID}
        navigationOverrides={supportedLanguagesNavigationOverrides}
        asChild
      >
        <div className="game-page__languages-title">
          <Typography>Languages</Typography>

          <div className="game-page__languages-labels">
            <Typography className="game-page__languages-label">
              Caption
            </Typography>
            <Typography className="game-page__languages-label">
              Audio
            </Typography>
          </div>
        </div>
      </FocusItem>

      <Box className="game-page__languages">
        <div className="game-page__languages-content">
          {languages.map((lang, index) => renderRow(lang, index))}
        </div>
      </Box>
    </div>
  );
}
