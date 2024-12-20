import { Badge, Button } from "@renderer/components";

import type { DownloadSource } from "@types";

import cn from "classnames";

import { useAppDispatch, useAppSelector, useRepacks } from "@renderer/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LightBulbIcon, SearchIcon, XIcon } from "@primer/octicons-react";

import "./catalogue.scss";

import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { downloadSourcesTable } from "@renderer/dexie";
import { steamUrlBuilder } from "@shared";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FilterSection } from "./filter-section";
import { setSearch } from "@renderer/features";
import { useTranslation } from "react-i18next";
import { steamUserTags } from "./steam-user-tags";

const filterCategoryColors = {
  genres: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
};

export default function Catalogue() {
  const inputRef = useRef<HTMLInputElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const [focused, setFocused] = useState(false);

  const [searchParams] = useSearchParams();
  const search = searchParams.get("search");

  const navigate = useNavigate();

  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [publishers, setPublishers] = useState<string[]>([]);
  const [developers, setDevelopers] = useState<string[]>([]);

  const filters = useAppSelector((state) => state.catalogueSearch.value);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("catalogue");

  const { getRepacksForObjectId } = useRepacks();

  useEffect(() => {
    setGames([]);
    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    window.electron.searchGames(filters).then((games) => {
      if (abortController.signal.aborted) {
        return;
      }

      setGames(games);
    });
  }, [filters]);

  useEffect(() => {
    window.electron.getDevelopers().then((developers) => {
      setDevelopers(developers);
    });

    window.electron.getPublishers().then((publishers) => {
      setPublishers(publishers);
    });
  }, []);

  const gamesWithRepacks = useMemo(() => {
    return games.map((game) => {
      const repacks = getRepacksForObjectId(game.objectId);
      const uniqueRepackers = Array.from(
        new Set(repacks.map((repack) => repack.repacker))
      );
      return { ...game, repacks: uniqueRepackers };
    });
  }, [games, getRepacksForObjectId]);

  useEffect(() => {
    downloadSourcesTable.toArray().then((sources) => {
      setDownloadSources(sources);
    });
  }, [getRepacksForObjectId]);

  const focusInput = useCallback(() => {
    setFocused(true);
    inputRef.current?.focus();
  }, []);

  const onSearch = useCallback(
    (value: string) => {
      dispatch(setSearch({ title: value }));
    },
    [dispatch]
  );

  useEffect(() => {
    if (search) {
      focusInput();
    }
  }, [search, focusInput]);

  return (
    <div className="catalogue">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
        }}
      >
        <div
          className={cn("catalogue__search-container", {
            ["catalogue__search-container--focused"]: focused,
          })}
        >
          <button
            type="button"
            className="catalogue__search-icon-button"
            onClick={focusInput}
          >
            <SearchIcon />
          </button>

          <input
            ref={inputRef}
            type="text"
            name="search"
            placeholder={t("search")}
            value={filters.title}
            className="catalogue__search-input"
            onChange={(event) => onSearch(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />

          {filters.title && (
            <button
              type="button"
              onClick={() => dispatch(setSearch({ title: "" }))}
              className="catalogue__search-clear-button"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filters.genres.map((genre) => (
            <Badge key={genre}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    backgroundColor: filterCategoryColors.genres,
                    borderRadius: "50%",
                  }}
                />

                {genre}
              </div>
            </Badge>
          ))}

          {filters.tags.map((tag) => (
            <Badge key={tag}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {tag}
              </div>
            </Badge>
          ))}

          {filters.downloadSourceFingerprints.map((fingerprint) => (
            <Badge key={fingerprint}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    backgroundColor:
                      filterCategoryColors.downloadSourceFingerprints,
                    borderRadius: "50%",
                  }}
                />

                {
                  downloadSources.find(
                    (source) => source.fingerprint === fingerprint
                  )?.name
                }
              </div>
            </Badge>
          ))}
        </div>

        {/* <Button theme="outline">
          <XIcon />
          Clear filters
        </Button> */}
      </div>

      <div
        style={{
          display: "flex",
          gap: SPACING_UNIT * 2,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            gap: 8,
          }}
        >
          {gamesWithRepacks.map((game, i) => (
            <button
              type="button"
              key={i}
              className="catalogue__game-item"
              onClick={() => navigate(buildGameDetailsPath(game))}
            >
              <img
                style={{
                  width: 200,
                  height: "100%",
                  objectFit: "cover",
                }}
                src={steamUrlBuilder.library(game.objectId)}
                alt={game.title}
                loading="lazy"
              />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                  padding: "16px 0",
                }}
              >
                <span>{game.title}</span>
                <span
                  style={{
                    color: vars.color.body,
                    marginBottom: 4,
                    fontSize: 12,
                  }}
                >
                  {game.genres?.join(", ")}
                </span>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {game.repacks.map((repack) => (
                    <Badge key={repack}>{repack}</Badge>
                  ))}
                </div>
              </div>
            </button>
          ))}

          <div style={{ display: "flex", gap: 8 }}>
            <Button theme="outline">1</Button>
            <Button theme="outline">2</Button>
          </div>
        </div>

        <div className="catalogue__filters-container">
          <Button
            style={{ width: "100%", marginBottom: 16 }}
            theme="outline"
            className="catalogue__ai-recommendations-button"
          >
            <span className="catalogue__ai-recommendations-button-text">
              <LightBulbIcon size={14} />
              Recomendações por AI
            </span>
          </Button>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FilterSection
              title="Genres"
              color={filterCategoryColors.genres}
              onSelect={(value) => {
                if (filters.genres.includes(value)) {
                  dispatch(
                    setSearch({
                      genres: filters.genres.filter((genre) => genre !== value),
                    })
                  );
                } else {
                  dispatch(setSearch({ genres: [...filters.genres, value] }));
                }
              }}
              items={[
                "Action",
                "Strategy",
                "RPG",
                "Casual",
                "Racing",
                "Sports",
                "Indie",
                "Adventure",
                "Simulation",
                "Massively Multiplayer",
                "Free to Play",
                "Accounting",
                "Animation & Modeling",
                "Audio Production",
                "Design & Illustration",
                "Education",
                "Photo Editing",
                "Software Training",
                "Utilities",
                "Video Production",
                "Web Publishing",
                "Game Development",
                "Early Access",
                "Sexual Content",
                "Nudity",
                "Violent",
                "Gore",
                "Documentary",
                "Tutorial",
              ]
                .sort()
                .map((genre) => ({
                  label: genre,
                  value: genre,
                  checked: filters.genres.includes(genre),
                }))}
            />

            <FilterSection
              title="User tags"
              color={filterCategoryColors.tags}
              onSelect={(value) => {
                if (filters.tags.includes(value)) {
                  dispatch(
                    setSearch({
                      tags: filters.tags.filter((tag) => tag !== value),
                    })
                  );
                } else {
                  dispatch(setSearch({ tags: [...filters.tags, value] }));
                }
              }}
              items={Object.entries(steamUserTags)
                .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                .map(([key, value]) => ({
                  label: key,
                  value: value,
                  checked: filters.tags.includes(value),
                }))}
            />

            <FilterSection
              title="Download sources"
              color={filterCategoryColors.downloadSourceFingerprints}
              onSelect={(value) => {
                if (filters.downloadSourceFingerprints.includes(value)) {
                  dispatch(
                    setSearch({
                      downloadSourceFingerprints:
                        filters.downloadSourceFingerprints.filter(
                          (fingerprint) => fingerprint !== value
                        ),
                    })
                  );
                } else {
                  dispatch(
                    setSearch({
                      downloadSourceFingerprints: [
                        ...filters.downloadSourceFingerprints,
                        value,
                      ],
                    })
                  );
                }
              }}
              items={downloadSources.map((downloadSource) => ({
                label: downloadSource.name,
                value: downloadSource.fingerprint,
                checked: filters.downloadSourceFingerprints.includes(
                  downloadSource.fingerprint
                ),
              }))}
            />

            <FilterSection
              title="Developers"
              color={filterCategoryColors.developers}
              onSelect={(value) => {
                if (filters.developers.includes(value)) {
                  dispatch(
                    setSearch({
                      developers: filters.developers.filter(
                        (developer) => developer !== value
                      ),
                    })
                  );
                } else {
                  dispatch(
                    setSearch({ developers: [...filters.developers, value] })
                  );
                }
              }}
              items={developers.map((developer) => ({
                label: developer,
                value: developer,
                checked: filters.developers.includes(developer),
              }))}
            />

            <FilterSection
              title="Publishers"
              color={filterCategoryColors.publishers}
              onSelect={(value) => {
                if (filters.publishers.includes(value)) {
                  dispatch(
                    setSearch({
                      publishers: filters.publishers.filter(
                        (publisher) => publisher !== value
                      ),
                    })
                  );
                } else {
                  dispatch(
                    setSearch({ publishers: [...filters.publishers, value] })
                  );
                }
              }}
              items={publishers.map((publisher) => ({
                label: publisher,
                value: publisher,
                checked: filters.publishers.includes(publisher),
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
