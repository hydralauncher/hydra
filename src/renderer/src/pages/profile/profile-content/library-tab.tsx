import { useTranslation } from "react-i18next";
import {
  TelescopeIcon,
  TrophyIcon,
  ClockIcon,
  HistoryIcon,
  StackIcon,
  DeviceDesktopIcon,
} from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import { useFormat } from "@renderer/hooks";
import type { UserGame } from "@types";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";
import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import { UserLibraryGameCard } from "./user-library-game-card";
import "./profile-content.scss";

type SortOption = "playtime" | "achievementCount" | "playedRecently";
export type ProfilePlatform = "all" | "pc" | "classics";

interface LibraryTabProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
  platform: ProfilePlatform;
  onPlatformChange: (platform: ProfilePlatform) => void;
  pinnedGames: UserGame[];
  libraryGames: UserGame[];
  hasMoreLibraryGames: boolean;
  statsIndex: number;
  userStats: { libraryCount: number } | null;
  onLoadMore: () => void;
  isMe: boolean;
  titleKey?: string;
  panelKey?: string;
  count?: number | null;
}

export function LibraryTab({
  sortBy,
  onSortChange,
  platform,
  onPlatformChange,
  pinnedGames,
  libraryGames,
  hasMoreLibraryGames,
  statsIndex,
  userStats,
  onLoadMore,
  isMe,
  titleKey = "library",
  panelKey = "library",
  count,
}: Readonly<LibraryTabProps>) {
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const platformOptions: FilterDropdownOption<ProfilePlatform>[] = [
    { value: "all", label: t("platform_all"), icon: StackIcon },
    { value: "pc", label: t("platform_pc"), icon: DeviceDesktopIcon },
    { value: "classics", label: t("platform_classics"), icon: ClassicsIcon },
  ];

  const sortOptions: FilterDropdownOption<SortOption>[] = [
    {
      value: "achievementCount",
      label: t("achievements_earned"),
      icon: TrophyIcon,
    },
    { value: "playedRecently", label: t("played_recently"), icon: HistoryIcon },
    { value: "playtime", label: t("playtime"), icon: ClockIcon },
  ];

  const hasGames = libraryGames.length > 0;
  const hasPinnedGames = pinnedGames.length > 0;
  const hasAnyGames = hasGames || hasPinnedGames;

  const resolvedCount =
    count !== undefined ? count : (userStats?.libraryCount ?? null);

  return (
    <div
      key={panelKey}
      className="profile-content__tab-panel"
      aria-hidden={false}
    >
      <div className="profile-content__library-filters">
        <FilterDropdown
          placeholder={t("platform")}
          value={platform}
          options={platformOptions}
          onChange={onPlatformChange}
        />
        {hasAnyGames && (
          <FilterDropdown
            placeholder={t("sort_by")}
            value={sortBy}
            options={sortOptions}
            onChange={onSortChange}
          />
        )}
      </div>

      {!hasAnyGames && (
        <div className="profile-content__no-games">
          <div className="profile-content__telescope-icon">
            <TelescopeIcon size={24} />
          </div>
          <h2>{t("no_recent_activity_title")}</h2>
          {isMe && <p>{t("no_recent_activity_description")}</p>}
        </div>
      )}

      {hasAnyGames && (
        <div>
          {hasPinnedGames && (
            <div style={{ marginBottom: "2rem" }}>
              <div className="profile-content__section-header">
                <div className="profile-content__section-title-group">
                  <h2>{t("pinned")}</h2>
                  <span className="profile-content__section-badge">
                    {pinnedGames.length}
                  </span>
                </div>
              </div>

              <ul className="profile-content__games-grid">
                {pinnedGames?.map((game) => (
                  <li key={game.objectId} style={{ listStyle: "none" }}>
                    <UserLibraryGameCard
                      game={game}
                      statIndex={statsIndex}
                      sortBy={sortBy}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasGames && (
            <div>
              <div className="profile-content__section-header">
                <div className="profile-content__section-title-group">
                  <h2>{t(titleKey)}</h2>
                  {resolvedCount !== null && (
                    <span className="profile-content__section-badge">
                      {numberFormatter.format(resolvedCount)}
                    </span>
                  )}
                </div>
              </div>

              <InfiniteScroll
                dataLength={libraryGames.length}
                next={onLoadMore}
                hasMore={hasMoreLibraryGames}
                loader={null}
                scrollThreshold={0.9}
                style={{ overflow: "visible" }}
                scrollableTarget="scrollableDiv"
              >
                <ul className="profile-content__games-grid">
                  {libraryGames?.map((game) => {
                    return (
                      <li
                        key={`${sortBy}-${game.objectId}`}
                        style={{ listStyle: "none" }}
                      >
                        <UserLibraryGameCard
                          game={game}
                          statIndex={statsIndex}
                          sortBy={sortBy}
                        />
                      </li>
                    );
                  })}
                </ul>
              </InfiniteScroll>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
