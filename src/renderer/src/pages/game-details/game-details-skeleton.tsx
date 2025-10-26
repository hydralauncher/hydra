import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

export function GameDetailsSkeleton() {
  return (
    <div className="game-details__wrapper game-details__skeleton">
      <section className="game-details__container">
        <div className="game-details__hero">
          <Skeleton
            height={350}
            style={{
              borderRadius: "0px 0px 8px 8px",
              position: "absolute",
              width: "100%",
              zIndex: 0,
            }}
          />

          <div className="game-details__hero-logo-backdrop">
            <div className="game-details__hero-content">
              <div className="game-details__game-logo" />
              <div className="game-details__hero-buttons game-details__hero-buttons--right" />
            </div>

            <div className="game-details__hero-panel">
              <div className="hero-panel__container">
                <div className="hero-panel">
                  <div className="hero-panel__content">
                    <Skeleton height={16} width={150} />
                    <Skeleton height={16} width={120} />
                  </div>
                  <div className="hero-panel__actions" style={{ gap: "16px" }}>
                    <Skeleton
                      height={36}
                      width={36}
                      style={{ borderRadius: "6px" }}
                    />
                    <Skeleton
                      height={36}
                      width={36}
                      style={{ borderRadius: "6px" }}
                    />
                    <Skeleton
                      height={36}
                      width={100}
                      style={{ borderRadius: "6px" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="game-details__description-container">
          <div className="game-details__description-content">
            <div className="description-header">
              <section className="description-header__info">
                <Skeleton height={16} width={200} />
                <Skeleton height={16} width={150} />
              </section>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <Skeleton
                height={200}
                width="100%"
                style={{ borderRadius: "8px" }}
              />
            </div>

            <div className="game-details__description">
              <Skeleton count={8} height={22} style={{ marginBottom: "8px" }} />
              <Skeleton height={22} width="60%" />
            </div>

            <Skeleton
              height={36}
              width={100}
              style={{
                borderRadius: "4px",
                marginTop: "24px",
                alignSelf: "center",
              }}
            />

            <div style={{ marginTop: "48px" }} />
          </div>

          <aside className="content-sidebar">
            <div className="sidebar-section">
              <div
                className="sidebar-section__button"
                style={{ pointerEvents: "none" }}
              >
                <Skeleton height={16} width={16} />
                <Skeleton height={16} width={60} />
              </div>

              <div className="sidebar-section__content">
                <div className="stats__section">
                  <div className="stats__category">
                    <div className="stats__category-title">
                      <Skeleton height={14} width={14} />
                      <Skeleton height={14} width={80} />
                    </div>
                    <Skeleton height={14} width={40} />
                  </div>

                  <div className="stats__category">
                    <div className="stats__category-title">
                      <Skeleton height={14} width={14} />
                      <Skeleton height={14} width={70} />
                    </div>
                    <Skeleton height={14} width={35} />
                  </div>

                  <div className="stats__category">
                    <div className="stats__category-title">
                      <Skeleton height={14} width={14} />
                      <Skeleton height={14} width={60} />
                    </div>
                    <Skeleton height={14} width={30} />
                  </div>
                </div>
              </div>
            </div>

            <div className="sidebar-section">
              <div
                className="sidebar-section__button"
                style={{ pointerEvents: "none" }}
              >
                <Skeleton height={16} width={16} />
                <Skeleton height={16} width={120} />
              </div>

              <div className="sidebar-section__content">
                <ul className="list">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li key={index}>
                      <div
                        className="list__item"
                        style={{ pointerEvents: "none" }}
                      >
                        <Skeleton
                          height={54}
                          width={54}
                          style={{ borderRadius: "4px" }}
                        />
                        <div>
                          <Skeleton
                            height={14}
                            width={120}
                            style={{ marginBottom: "4px" }}
                          />
                          <Skeleton height={12} width={80} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
