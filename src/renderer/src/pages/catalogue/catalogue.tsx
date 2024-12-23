import { Badge } from "@renderer/components";

import type { DownloadSource } from "@types";

import cn from "classnames";

import { useAppDispatch, useAppSelector, useRepacks } from "@renderer/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@primer/octicons-react";

import "./catalogue.scss";

import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { downloadSourcesTable } from "@renderer/dexie";
import { steamUrlBuilder } from "@shared";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FilterSection } from "./filter-section";
import { setSearch } from "@renderer/features";
import { useTranslation } from "react-i18next";
import axios from "axios";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

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

  const [steamUserTags, setSteamUserTags] = useState<any>({});

  const [searchParams] = useSearchParams();
  const search = searchParams.get("search");

  const navigate = useNavigate();

  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [publishers, setPublishers] = useState<string[]>([]);
  const [developers, setDevelopers] = useState<string[]>([]);

  const filters = useAppSelector((state) => state.catalogueSearch.value);

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");

  const { getRepacksForObjectId } = useRepacks();

  useEffect(() => {
    setGames([]);
    setIsLoading(true);
    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    window.electron
      .searchGames(filters)
      .then((games) => {
        if (abortController.signal.aborted) {
          return;
        }

        setGames(games);
      })
      .finally(() => {
        setIsLoading(false);
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
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
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
    axios
      .get(
        `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/steam-user-tags.json`
      )
      .then((response) => {
        const language = i18n.language.split("-")[0];

        if (response.data[language]) {
          setSteamUserTags(response.data[language]);
        } else {
          setSteamUserTags(response.data["en"]);
        }
      });
  }, [i18n.language]);

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

          <li
            style={{
              display: "flex",
              alignItems: "center",
              color: vars.color.body,
              backgroundColor: vars.color.darkBackground,
              padding: "6px 12px",
              borderRadius: 4,
              border: `solid 1px ${vars.color.border}`,
              fontSize: 12,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                backgroundColor: filterCategoryColors.genres,
                borderRadius: "50%",
                marginRight: 8,
              }}
            />
            Action
            <button
              type="button"
              style={{
                color: vars.color.body,
                marginLeft: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <XIcon size={13} />
            </button>
          </li>
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
          {isLoading ? (
            <SkeletonTheme
              baseColor={vars.color.darkBackground}
              highlightColor={vars.color.background}
            >
              {Array.from({ length: 24 }).map((_, i) => (
                <Skeleton
                  key={i}
                  style={{
                    height: 105,
                    borderRadius: 4,
                    border: `solid 1px ${vars.color.border}`,
                  }}
                />
              ))}
            </SkeletonTheme>
          ) : (
            gamesWithRepacks.map((game, i) => (
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
            ))
          )}

          {/* <div style={{ display: "flex", gap: 8 }}>
            <Button theme="outline">1</Button>
            <Button theme="outline">2</Button>
          </div> */}
        </div>

        <div className="catalogue__filters-container">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FilterSection
              title={t("genres")}
              onClear={() => dispatch(setSearch({ genres: [] }))}
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
              title={t("tags")}
              color={filterCategoryColors.tags}
              onClear={() => dispatch(setSearch({ tags: [] }))}
              onSelect={(value) => {
                if (filters.tags.includes(Number(value))) {
                  dispatch(
                    setSearch({
                      tags: filters.tags.filter((tag) => tag !== Number(value)),
                    })
                  );
                } else {
                  dispatch(
                    setSearch({ tags: [...filters.tags, Number(value)] })
                  );
                }
              }}
              items={
                Object.entries(steamUserTags)
                  .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                  .map(([key, value]) => ({
                    label: key,
                    value: value,
                    checked: filters.tags.includes(value as number),
                  })) as any
              }
            />

            <FilterSection
              title={t("download_sources")}
              color={filterCategoryColors.downloadSourceFingerprints}
              onClear={() =>
                dispatch(setSearch({ downloadSourceFingerprints: [] }))
              }
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
              title={t("developers")}
              color={filterCategoryColors.developers}
              onClear={() => dispatch(setSearch({ developers: [] }))}
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
              title={t("publishers")}
              color={filterCategoryColors.publishers}
              onClear={() => dispatch(setSearch({ publishers: [] }))}
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
