import { useCallback, useEffect, useRef, useState } from "react";
import { HorizontalFocusGroup } from "../../components";
import {
  animateNavigationScrollForElement,
  cancelNavigationAutoScrollForElement,
} from "../../helpers";
import { useHeaderTitle, useNavigationActions } from "../../hooks";
import {
  CATALOGUE_EMPTY_STATE_ID,
  CATALOGUE_ERROR_STATE_ID,
  CATALOGUE_PAGE_REGION_ID,
  getCatalogueCardFocusId,
} from "./navigation";
import { CatalogueGrid } from "./grid";
import { CatalogueHeader } from "./header";
import { CataloguePagination } from "./pagination";
import { CatalogueSidebar } from "./sidebar";
import { useCatalogueData } from "./use-catalogue-data";
import "./page.scss";

export default function Catalogue() {
  useHeaderTitle("Catalogue");
  const { setFocus } = useNavigationActions();
  const pageRef = useRef<HTMLElement | null>(null);
  const releaseAutoScrollSuppressionTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const [shouldFocusPageResults, setShouldFocusPageResults] = useState(false);
  const [suppressPageAutoScroll, setSuppressPageAutoScroll] = useState(false);

  const {
    values,
    updateSearchParams,
    catalogueData,
    search,
    page,
    pageSize,
    totalPages,
    changePage,
  } = useCatalogueData();

  const handlePageChange = useCallback(
    (nextPage: number) => {
      if (nextPage === page) return;

      if (releaseAutoScrollSuppressionTimeoutRef.current !== null) {
        globalThis.clearTimeout(releaseAutoScrollSuppressionTimeoutRef.current);
        releaseAutoScrollSuppressionTimeoutRef.current = null;
      }

      cancelNavigationAutoScrollForElement(pageRef.current);
      setShouldFocusPageResults(true);
      setSuppressPageAutoScroll(true);
      pageRef.current?.setAttribute(
        "data-suppress-navigation-autoscroll",
        "true"
      );
      animateNavigationScrollForElement(pageRef.current, { top: 0, left: 0 });
      changePage(nextPage);
    },
    [changePage, page]
  );

  useEffect(() => {
    if (!shouldFocusPageResults || search.isLoading) return;

    const targetId = search.isError
      ? CATALOGUE_ERROR_STATE_ID
      : search.data?.edges[0]
        ? getCatalogueCardFocusId(search.data.edges[0].id)
        : CATALOGUE_EMPTY_STATE_ID;
    const animationFrameId = globalThis.requestAnimationFrame(() => {
      cancelNavigationAutoScrollForElement(pageRef.current);
      pageRef.current?.scrollTo({ top: 0, left: 0 });

      if (setFocus(targetId)) {
        setShouldFocusPageResults(false);
        pageRef.current?.scrollTo({ top: 0, left: 0 });

        releaseAutoScrollSuppressionTimeoutRef.current = globalThis.setTimeout(
          () => {
            cancelNavigationAutoScrollForElement(pageRef.current);
            pageRef.current?.scrollTo({ top: 0, left: 0 });
            setSuppressPageAutoScroll(false);
            pageRef.current?.removeAttribute(
              "data-suppress-navigation-autoscroll"
            );
            releaseAutoScrollSuppressionTimeoutRef.current = null;
          },
          250
        );
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [
    search.data,
    search.isError,
    search.isLoading,
    setFocus,
    shouldFocusPageResults,
  ]);

  useEffect(
    () => () => {
      if (releaseAutoScrollSuppressionTimeoutRef.current !== null) {
        globalThis.clearTimeout(releaseAutoScrollSuppressionTimeoutRef.current);
      }
    },
    []
  );

  if (!catalogueData) return null;

  return (
    <HorizontalFocusGroup regionId={CATALOGUE_PAGE_REGION_ID} asChild>
      <section
        ref={pageRef}
        className="catalogue-results-page"
        data-suppress-navigation-autoscroll={
          suppressPageAutoScroll ? "true" : undefined
        }
      >
        <div className="catalogue-container">
          <CatalogueHeader
            values={values}
            updateSearchParams={updateSearchParams}
            catalogueData={catalogueData}
          />

          <div className="catalogue-content">
            <CatalogueGrid search={search} pageSize={pageSize} />

            {!search.isError ? (
              <CataloguePagination
                page={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            ) : null}

            <CatalogueSidebar
              catalogueData={catalogueData}
              values={values}
              updateSearchParams={updateSearchParams}
            />
          </div>
        </div>
      </section>
    </HorizontalFocusGroup>
  );
}
