/**
 * Genre names come from the API as English strings. The API also serves the
 * same list in other languages, index-aligned with the English one, so a
 * localized name is found by looking up the English name's index.
 * The list is shared by the Steam and Classics (LaunchBox) catalogues.
 */
export type LocalizedGenres = Record<string, string[]>;

export const getGenreLanguage = (locale: string) =>
  locale.split("-")[0] || "en";

export const translateGenreName = (
  genres: LocalizedGenres,
  language: string,
  genre: string
): string => {
  const englishGenres = genres["en"];
  const localizedGenres = genres[language];

  if (!englishGenres || !localizedGenres || language === "en") return genre;

  const index = englishGenres.indexOf(genre);
  if (index === -1) return genre;

  return localizedGenres[index] || genre;
};

export const translateGenreNames = (
  genres: LocalizedGenres,
  language: string,
  names: readonly string[]
) => names.map((name) => translateGenreName(genres, language, name));
