import List, { type ListRef } from "rc-virtual-list";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Checkbox, Typography } from "../../components";
import { useNavigationActions } from "../../hooks";
import { getCatalogueFilterCheckboxFocusId } from "./navigation";
import { FilterType, type SearchGamesFormValues } from "./use-catalogue-data";

export type CatalogueFilterData =
  | string[]
  | Record<string, number>
  | Record<string, string>;

export interface CatalogueFilterListItem {
  label: string;
  value: string | number;
  focusId: string;
}

export type CatalogueFilterListAlignment = "top" | "bottom" | "auto";

export interface CatalogueFilterListHandle {
  focusItem: (
    index: number,
    alignment?: CatalogueFilterListAlignment
  ) => boolean;
}

interface FilterSectionProps {
  items: CatalogueFilterListItem[];
  name: FilterType;
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
}

const ITEM_HEIGHT = 44;
const FALLBACK_VISIBLE_ITEMS = 10;
const POINTER_SCROLL_SUPPRESSION_DURATION_MS = 250;
const autoScrollSuppressionTimers = new WeakMap<HTMLElement, number>();

function suppressSidebarNavigationAutoScroll(viewport: HTMLElement) {
  const sidebar = viewport.closest(".catalogue__sidebar");

  if (!(sidebar instanceof HTMLElement)) return;

  const pendingTimeoutId = autoScrollSuppressionTimers.get(sidebar);

  if (pendingTimeoutId !== undefined) {
    globalThis.window.clearTimeout(pendingTimeoutId);
  }

  sidebar.dataset.suppressNavigationAutoscroll = "true";

  const timeoutId = globalThis.window.setTimeout(() => {
    sidebar.removeAttribute("data-suppress-navigation-autoscroll");
    autoScrollSuppressionTimers.delete(sidebar);
  }, POINTER_SCROLL_SUPPRESSION_DURATION_MS);

  autoScrollSuppressionTimers.set(sidebar, timeoutId);
}

export function getCatalogueFilterListItems(
  listData: CatalogueFilterData,
  name: FilterType,
  searchTerm = ""
) {
  const labels = Array.isArray(listData) ? listData : Object.keys(listData);
  const filteredLabels = searchTerm
    ? labels.filter((label) =>
        label.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : labels;

  return filteredLabels.map<CatalogueFilterListItem>((label) => {
    const value = Array.isArray(listData) ? label : listData[label];

    return {
      label,
      value,
      focusId: getCatalogueFilterCheckboxFocusId(name, String(value)),
    };
  });
}

export const CatalogueFilterList = forwardRef<
  CatalogueFilterListHandle,
  Readonly<FilterSectionProps>
>(function CatalogueFilterList(
  { items, name, values, updateSearchParams },
  ref
) {
  const listRef = useRef<ListRef>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const pendingFrameIdRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const { setFocus } = useNavigationActions();

  const selected = (values[name] ?? []) as Array<string | number>;
  const visibleItemCount =
    viewportHeight === null
      ? FALLBACK_VISIBLE_ITEMS
      : Math.max(1, Math.floor(viewportHeight / ITEM_HEIGHT));
  const height = ITEM_HEIGHT * Math.min(items.length, visibleItemCount);
  const handlePointerScrollStart = () => {
    const viewport = viewportRef.current;

    if (viewport) {
      suppressSidebarNavigationAutoScroll(viewport);
    }
  };

  const handleChange = (value: string | number, checked: boolean) => {
    updateSearchParams({
      [name]: checked
        ? [...selected, value]
        : selected.filter((item) => item !== value),
    });
  };

  const resolvePendingFocus = useCallback(() => {
    const pendingFocusId = pendingFocusIdRef.current;

    if (!pendingFocusId) return;

    if (pendingFrameIdRef.current !== null) {
      globalThis.cancelAnimationFrame(pendingFrameIdRef.current);
    }

    pendingFrameIdRef.current = globalThis.requestAnimationFrame(() => {
      pendingFrameIdRef.current = null;

      if (
        pendingFocusIdRef.current === pendingFocusId &&
        setFocus(pendingFocusId)
      ) {
        pendingFocusIdRef.current = null;
      }
    });
  }, [setFocus]);

  useImperativeHandle(
    ref,
    () => ({
      focusItem: (index, alignment = "auto") => {
        const item = items[index];

        if (!item) return false;

        pendingFocusIdRef.current = item.focusId;
        listRef.current?.scrollTo({ index, align: alignment });

        if (setFocus(item.focusId)) {
          pendingFocusIdRef.current = null;
          return true;
        }

        resolvePendingFocus();
        return true;
      },
    }),
    [items, resolvePendingFocus, setFocus]
  );

  useEffect(() => {
    const pendingFocusId = pendingFocusIdRef.current;

    if (
      pendingFocusId &&
      !items.some((item) => item.focusId === pendingFocusId)
    ) {
      pendingFocusIdRef.current = null;
    }
  }, [items]);

  useEffect(() => {
    return () => {
      if (pendingFrameIdRef.current !== null) {
        globalThis.cancelAnimationFrame(pendingFrameIdRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) return;

    const updateViewportHeight = () => {
      const nextHeight = viewport.clientHeight;
      setViewportHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  if (items.length === 0) {
    return (
      <div ref={viewportRef} className="catalogue-filter-list__viewport">
        <div className="filter-section__empty">
          <Typography variant="label" className="filter-section__empty__text">
            No results found
          </Typography>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="catalogue-filter-list__viewport"
      onWheelCapture={handlePointerScrollStart}
      onPointerDownCapture={handlePointerScrollStart}
    >
      {height > 0 ? (
        <List
          ref={listRef}
          className="catalogue-filter-list"
          data={items}
          height={height}
          itemHeight={ITEM_HEIGHT}
          itemKey={(item) => item.focusId}
          onVisibleChange={resolvePendingFocus}
        >
          {(item) => (
            <div className="filter-section__item">
              <Checkbox
                id={`${name}-${item.label}`}
                focusId={item.focusId}
                label={item.label}
                checked={selected.includes(item.value)}
                onChange={(checked) => handleChange(item.value, checked)}
                block
              />
            </div>
          )}
        </List>
      ) : null}
    </div>
  );
});
