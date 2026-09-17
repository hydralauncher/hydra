import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { setGenres } from "@renderer/features";
import { logger } from "@renderer/logger";
import { getGenreLanguage, translateGenreName } from "./genre-translation";
import { getLocalizedGenres } from "./localized-steam-metadata";
import { useAppDispatch, useAppSelector } from "./redux";

/**
 * Translates English genre names (Steam and Classics) into the UI language,
 * loading the shared genre list on demand when the catalogue has not already
 * done so.
 */
export function useGenreTranslation() {
  const { i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const steamGenres = useAppSelector(
    (state) => state.catalogueSearch.steamGenres
  );

  const locale = i18n.language;
  const language = getGenreLanguage(locale);
  const hasGenresForLanguage = Boolean(steamGenres[language]);

  useEffect(() => {
    if (hasGenresForLanguage) return;

    let cancelled = false;

    getLocalizedGenres(locale)
      .then((genres) => {
        if (!cancelled) dispatch(setGenres(genres));
      })
      .catch((error) => {
        logger.error("Failed to fetch genre translations", error);
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, hasGenresForLanguage, locale]);

  const translateGenre = useCallback(
    (genre: string) => translateGenreName(steamGenres, language, genre),
    [steamGenres, language]
  );

  return { translateGenre, language, steamGenres };
}
