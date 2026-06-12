import { useCallback, useEffect, useRef, useState } from "react";
import { HorizontalFocusGroup } from "../../components";
import { cancelNavigationAutoScrollForElement } from "../../helpers";
import { useHeaderTitle, useNavigationScreenActions } from "../../hooks";
import { CATALOGUE_PAGE_REGION_ID } from "./navigation";
import { CatalogueGrid } from "./grid";
import { CatalogueHeader } from "./header";
import { CatalogueFiltersModal } from "./filters-modal";
import { useCatalogueData } from "./use-catalogue-data";
import { NavigationAudioService } from "../../services";
import "./page.scss";

const POINTER_SCROLL_SUPPRESSION_DURATION_MS = 500;

export default function Catalogue() {
  useHeaderTitle("Catalogue");
  const pageRef = useRef<HTMLElement | null>(null);
  const pointerScrollSuppressionTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const isPointerScrollSuppressedRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const restorePointerScrollTopRef = useRef<number | null>(null);
  const wasLoadingMoreRef = useRef(false);
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState(false);

  const {
    mode,
    filterTypes,
    values,
    updateSearchParams,
    catalogueData,
    search,
    pageSize,
    hasNextPage,
    loadMore,
  } = useCatalogueData();

  useEffect(() => {
    isLoadingMoreRef.current = search.isLoadingMore;
  }, [search.isLoadingMore]);

  const schedulePointerScrollSuppressionRelease = useCallback(() => {
    if (pointerScrollSuppressionTimeoutRef.current !== null) {
      globalThis.clearTimeout(pointerScrollSuppressionTimeoutRef.current);
    }

    pointerScrollSuppressionTimeoutRef.current = globalThis.setTimeout(() => {
      pointerScrollSuppressionTimeoutRef.current = null;

      if (isLoadingMoreRef.current) {
        schedulePointerScrollSuppressionRelease();
        return;
      }

      isPointerScrollSuppressedRef.current = false;
      pageRef.current?.removeAttribute("data-suppress-navigation-autoscroll");
    }, POINTER_SCROLL_SUPPRESSION_DURATION_MS);
  }, []);

  const handlePointerScrollStart = useCallback(() => {
    cancelNavigationAutoScrollForElement(pageRef.current);
    isPointerScrollSuppressedRef.current = true;
    pageRef.current?.setAttribute(
      "data-suppress-navigation-autoscroll",
      "true"
    );
    schedulePointerScrollSuppressionRelease();
  }, [schedulePointerScrollSuppressionRelease]);

  const handleScroll = useCallback(() => {
    if (!isPointerScrollSuppressedRef.current) return;

    cancelNavigationAutoScrollForElement(pageRef.current);
    schedulePointerScrollSuppressionRelease();
  }, [schedulePointerScrollSuppressionRelease]);

  const handleLoadMore = useCallback(() => {
    if (isPointerScrollSuppressedRef.current) {
      restorePointerScrollTopRef.current = pageRef.current?.scrollTop ?? null;
      pageRef.current?.setAttribute(
        "data-suppress-navigation-autoscroll",
        "true"
      );
    }

    loadMore();
  }, [loadMore]);

  const openFiltersModal = useCallback(() => {
    if (isFiltersModalOpen) return;

    NavigationAudioService.getInstance().play("select");
    setIsFiltersModalOpen(true);
  }, [isFiltersModalOpen]);

  useEffect(() => {
    restorePointerScrollTopRef.current = null;
    wasLoadingMoreRef.current = false;
    isPointerScrollSuppressedRef.current = false;

    if (pointerScrollSuppressionTimeoutRef.current !== null) {
      globalThis.clearTimeout(pointerScrollSuppressionTimeoutRef.current);
      pointerScrollSuppressionTimeoutRef.current = null;
    }

    cancelNavigationAutoScrollForElement(pageRef.current);
    pageRef.current?.removeAttribute("data-suppress-navigation-autoscroll");

    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
  }, [search.key]);

  useEffect(() => {
    if (!search.isLoadingMore || !isPointerScrollSuppressedRef.current) return;

    restorePointerScrollTopRef.current =
      restorePointerScrollTopRef.current ?? pageRef.current?.scrollTop ?? null;
    pageRef.current?.setAttribute(
      "data-suppress-navigation-autoscroll",
      "true"
    );
    schedulePointerScrollSuppressionRelease();
  }, [schedulePointerScrollSuppressionRelease, search.isLoadingMore]);

  useEffect(() => {
    if (search.isLoadingMore) {
      wasLoadingMoreRef.current = true;
      return;
    }

    if (!wasLoadingMoreRef.current) return;

    wasLoadingMoreRef.current = false;

    const restoreScrollTop = restorePointerScrollTopRef.current;
    restorePointerScrollTopRef.current = null;

    if (restoreScrollTop === null || !isPointerScrollSuppressedRef.current) {
      return;
    }

    pageRef.current?.setAttribute(
      "data-suppress-navigation-autoscroll",
      "true"
    );

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      if (pageRef.current) {
        pageRef.current.scrollTop = restoreScrollTop;
      }

      schedulePointerScrollSuppressionRelease();
    });

    return () => globalThis.cancelAnimationFrame(animationFrameId);
  }, [schedulePointerScrollSuppressionRelease, search.isLoadingMore]);

  useEffect(() => {
    return () => {
      if (pointerScrollSuppressionTimeoutRef.current !== null) {
        globalThis.clearTimeout(pointerScrollSuppressionTimeoutRef.current);
      }
    };
  }, []);

  useNavigationScreenActions(
    isFiltersModalOpen
      ? {}
      : {
          press: {
            y: openFiltersModal,
          },
        }
  );

  return (
    <HorizontalFocusGroup regionId={CATALOGUE_PAGE_REGION_ID} asChild>
      <section
        ref={pageRef}
        className="catalogue-results-page"
        onPointerDownCapture={handlePointerScrollStart}
        onScrollCapture={handleScroll}
        onWheelCapture={handlePointerScrollStart}
      >
        <div className="catalogue-container">
          <CatalogueHeader
            values={values}
            updateSearchParams={updateSearchParams}
            catalogueData={catalogueData}
            onOpenFilters={openFiltersModal}
          />

          <div className="catalogue-content">
            <CatalogueGrid
              mode={mode}
              search={search}
              pageSize={pageSize}
              hasNextPage={hasNextPage}
              loadMore={handleLoadMore}
            />
          </div>
        </div>

        <CatalogueFiltersModal
          visible={isFiltersModalOpen}
          catalogueData={catalogueData}
          filterTypes={filterTypes}
          values={values}
          updateSearchParams={updateSearchParams}
          onClose={() => setIsFiltersModalOpen(false)}
        />
      </section>
    </HorizontalFocusGroup>
  );
}
