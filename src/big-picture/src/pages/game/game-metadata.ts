export function extractGenreNames(genres: readonly unknown[]) {
  const seen = new Set<string>();

  return genres
    .map((genre) => {
      if (typeof genre === "string") return genre.trim();
      if (!genre || typeof genre !== "object") return "";

      const { name, description } = genre as {
        name?: unknown;
        description?: unknown;
      };
      const value = typeof name === "string" ? name : description;

      return typeof value === "string" ? value.trim() : "";
    })
    .filter((genre) => {
      const normalizedGenre = genre.toLocaleLowerCase();
      if (!normalizedGenre || seen.has(normalizedGenre)) return false;

      seen.add(normalizedGenre);
      return true;
    });
}
