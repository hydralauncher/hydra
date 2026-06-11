import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, HorizontalFocusGroup } from "../../components";
import { useNavigationScreenActions } from "../../hooks";
import {
  CATALOGUE_PAGINATION_FIRST_ID,
  CATALOGUE_PAGINATION_LAST_ID,
  CATALOGUE_PAGINATION_NEXT_ID,
  CATALOGUE_PAGINATION_PREVIOUS_ID,
  CATALOGUE_PAGINATION_REGION_ID,
  getCataloguePaginationPageFocusId,
} from "./navigation";
import { useCataloguePaginationNavigation } from "./use-catalogue-pagination-navigation";

interface CataloguePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface VisiblePageRange {
  start: number;
  end: number;
  showLeadingJump: boolean;
  showTrailingJump: boolean;
}

function getVisiblePageRange(page: number, totalPages: number) {
  const visiblePages = 5;
  let start = Math.max(1, page - 1);
  let end = start + visiblePages - 1;

  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - visiblePages + 1);
  }

  const showTrailingJump = end < totalPages;
  const showLeadingJump = !showTrailingJump && start > 1;

  return {
    start,
    end,
    showLeadingJump,
    showTrailingJump,
  } satisfies VisiblePageRange;
}

function PaginationArrow({
  direction,
}: Readonly<{ direction: "left" | "right" }>) {
  return direction === "left" ? (
    <CaretLeftIcon size={18} weight="bold" aria-hidden="true" />
  ) : (
    <CaretRightIcon size={18} weight="bold" aria-hidden="true" />
  );
}

function PaginationDoubleArrow({
  direction,
}: Readonly<{ direction: "left" | "right" }>) {
  return (
    <span className="catalogue-pagination__double-arrow">
      <PaginationArrow direction={direction} />
      <PaginationArrow direction={direction} />
    </span>
  );
}

export function CataloguePagination({
  page,
  totalPages,
  onPageChange,
}: Readonly<CataloguePaginationProps>) {
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const jumpInputRef = useRef<HTMLInputElement | null>(null);
  const range = getVisiblePageRange(page, totalPages);
  const pageNumbers = Array.from(
    { length: range.end - range.start + 1 },
    (_, index) => range.start + index
  );
  const showLeadingJump = range.showLeadingJump;
  const showTrailingJump = range.showTrailingJump;
  const itemIds = useMemo(
    () => [
      ...(range.start > 1 ? [CATALOGUE_PAGINATION_FIRST_ID] : []),
      ...(page > 1 ? [CATALOGUE_PAGINATION_PREVIOUS_ID] : []),
      ...(showLeadingJump ? [getCataloguePaginationPageFocusId(1)] : []),
      ...pageNumbers.map((pageNumber) =>
        getCataloguePaginationPageFocusId(pageNumber)
      ),
      ...(showTrailingJump
        ? [getCataloguePaginationPageFocusId(totalPages)]
        : []),
      ...(page < totalPages ? [CATALOGUE_PAGINATION_NEXT_ID] : []),
      ...(range.end < totalPages ? [CATALOGUE_PAGINATION_LAST_ID] : []),
    ],
    [
      pageNumbers,
      range.end,
      range.start,
      page,
      showLeadingJump,
      showTrailingJump,
      totalPages,
    ]
  );
  const navigationOverridesById = useCataloguePaginationNavigation(itemIds);

  const closeJump = useCallback(() => {
    setIsJumpOpen(false);
  }, []);

  useEffect(() => {
    if (!isJumpOpen) return;

    setJumpValue("");
    jumpInputRef.current?.focus();
  }, [isJumpOpen]);

  useNavigationScreenActions(
    isJumpOpen
      ? {
          press: {
            b: closeJump,
          },
        }
      : {}
  );

  if (totalPages <= 1) return null;

  const changePage = (nextPage: number) => {
    const constrainedPage = Math.min(totalPages, Math.max(1, nextPage));

    if (constrainedPage !== page) {
      onPageChange(constrainedPage);
    }
  };

  const handleJumpValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replaceAll(/\D+/g, "");

    if (!digits) {
      setJumpValue("");
      return;
    }

    setJumpValue(
      String(Math.min(totalPages, Math.max(1, Number.parseInt(digits, 10))))
    );
  };

  const handleJumpKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      if (jumpValue) {
        changePage(Number.parseInt(jumpValue, 10));
        setIsJumpOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeJump();
    }
  };

  const renderJumpControl = () =>
    isJumpOpen ? (
      <input
        ref={jumpInputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Go to page"
        className="catalogue-pagination__input"
        value={jumpValue}
        onChange={handleJumpValueChange}
        onKeyDown={handleJumpKeyDown}
        onBlur={() => setIsJumpOpen(false)}
      />
    ) : (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Go to page"
        className="catalogue-pagination__button"
        focusable={false}
        onClick={() => setIsJumpOpen(true)}
      >
        {"..."}
      </Button>
    );

  return (
    <HorizontalFocusGroup
      regionId={CATALOGUE_PAGINATION_REGION_ID}
      className="catalogue-pagination"
      asChild
    >
      <nav aria-label="Catalogue pages">
        {range.start > 1 ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Go to first page"
            className="catalogue-pagination__button"
            focusId={CATALOGUE_PAGINATION_FIRST_ID}
            focusNavigationOverrides={
              navigationOverridesById[CATALOGUE_PAGINATION_FIRST_ID]
            }
            onClick={() => changePage(1)}
          >
            <PaginationDoubleArrow direction="left" />
          </Button>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Go to previous page"
          className="catalogue-pagination__button"
          focusId={CATALOGUE_PAGINATION_PREVIOUS_ID}
          focusNavigationOverrides={
            navigationOverridesById[CATALOGUE_PAGINATION_PREVIOUS_ID]
          }
          disabled={page === 1}
          onClick={() => changePage(page - 1)}
        >
          <PaginationArrow direction="left" />
        </Button>

        {showLeadingJump ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Go to page 1"
              className="catalogue-pagination__button"
              focusId={getCataloguePaginationPageFocusId(1)}
              focusNavigationOverrides={
                navigationOverridesById[getCataloguePaginationPageFocusId(1)]
              }
              onClick={() => changePage(1)}
            >
              {"1"}
            </Button>
            {renderJumpControl()}
          </>
        ) : null}

        {pageNumbers.map((pageNumber) => (
          <Button
            key={pageNumber}
            type="button"
            variant={page === pageNumber ? "primary" : "secondary"}
            size="icon"
            aria-label={`Go to page ${pageNumber}`}
            className="catalogue-pagination__button"
            focusId={getCataloguePaginationPageFocusId(pageNumber)}
            focusNavigationOverrides={
              navigationOverridesById[
                getCataloguePaginationPageFocusId(pageNumber)
              ]
            }
            onClick={() => changePage(pageNumber)}
          >
            {String(pageNumber)}
          </Button>
        ))}

        {showTrailingJump ? (
          <>
            {renderJumpControl()}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={`Go to page ${totalPages}`}
              className="catalogue-pagination__button"
              focusId={getCataloguePaginationPageFocusId(totalPages)}
              focusNavigationOverrides={
                navigationOverridesById[
                  getCataloguePaginationPageFocusId(totalPages)
                ]
              }
              onClick={() => changePage(totalPages)}
            >
              {String(totalPages)}
            </Button>
          </>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Go to next page"
          className="catalogue-pagination__button"
          focusId={CATALOGUE_PAGINATION_NEXT_ID}
          focusNavigationOverrides={
            navigationOverridesById[CATALOGUE_PAGINATION_NEXT_ID]
          }
          disabled={page === totalPages}
          onClick={() => changePage(page + 1)}
        >
          <PaginationArrow direction="right" />
        </Button>

        {range.end < totalPages ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Go to last page"
            className="catalogue-pagination__button"
            focusId={CATALOGUE_PAGINATION_LAST_ID}
            focusNavigationOverrides={
              navigationOverridesById[CATALOGUE_PAGINATION_LAST_ID]
            }
            onClick={() => changePage(totalPages)}
          >
            <PaginationDoubleArrow direction="right" />
          </Button>
        ) : null}
      </nav>
    </HorizontalFocusGroup>
  );
}
