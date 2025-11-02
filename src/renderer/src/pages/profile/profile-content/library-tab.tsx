import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { TelescopeIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import { useFormat } from "@renderer/hooks";
import type { UserGame } from "@types";
import { SortOptions } from "./sort-options";
import { UserLibraryGameCard } from "./user-library-game-card";
import "./profile-content.scss";

type SortOption = "playtime" | "achievementCount" | "playedRecently";

interface LibraryTabProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
  pinnedGames: UserGame[];
  libraryGames: UserGame[];
  hasMoreLibraryGames: boolean;
  isLoadingLibraryGames: boolean;
  statsIndex: number;
  userStats: { libraryCount: number } | null;
  animatedGameIdsRef: React.MutableRefObject<Set<string>>;
  onLoadMore: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isMe: boolean;
}

export function LibraryTab({
  sortBy,
  onSortChange,
  pinnedGames,
  libraryGames,
  hasMoreLibraryGames,
  isLoadingLibraryGames,
  statsIndex,
  userStats,
  animatedGameIdsRef,
  onLoadMore,
  onMouseEnter,
  onMouseLeave,
  isMe,
}: Readonly<LibraryTabProps>) {
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const hasGames = libraryGames.length > 0;
  const hasPinnedGames = pinnedGames.length > 0;
  const hasAnyGames = hasGames || hasPinnedGames;

  return (
    <motion.div
      key="library"
      className="profile-content__tab-panel"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      aria-hidden={false}
    >
      {hasAnyGames && <SortOptions sortBy={sortBy} onSortChange={onSortChange} />}

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
                      onMouseEnter={onMouseEnter}
                      onMouseLeave={onMouseLeave}
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
                  <h2>{t("library")}</h2>
                  {userStats && (
                    <span className="profile-content__section-badge">
                      {numberFormatter.format(userStats.libraryCount)}
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
                  {libraryGames?.map((game, index) => {
                    const hasAnimated =
                      animatedGameIdsRef.current.has(game.objectId);
                    const isNewGame = !hasAnimated && !isLoadingLibraryGames;

                    return (
                      <motion.li
                        key={`${sortBy}-${game.objectId}`}
                        style={{ listStyle: "none" }}
                        initial={
                          isNewGame
                            ? { opacity: 0.5, y: 15, scale: 0.96 }
                            : false
                        }
                        animate={
                          isNewGame ? { opacity: 1, y: 0, scale: 1 } : false
                        }
                        transition={
                          isNewGame
                            ? {
                                duration: 0.15,
                                ease: "easeOut",
                                delay: index * 0.01,
                              }
                            : undefined
                        }
                        onAnimationComplete={() => {
                          if (isNewGame) {
                            animatedGameIdsRef.current.add(game.objectId);
                          }
                        }}
                      >
                        <UserLibraryGameCard
                          game={game}
                          statIndex={statsIndex}
                          onMouseEnter={onMouseEnter}
                          onMouseLeave={onMouseLeave}
                          sortBy={sortBy}
                        />
                      </motion.li>
                    );
                  })}
                </ul>
              </InfiniteScroll>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

