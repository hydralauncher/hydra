import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

interface ShopCarouselPages {
  count: number;
  current: number;
  goTo: (page: number) => void;
}

/** One row that scrolls sideways; the pages feed the dots in the section header. */
/** `contentKey` changes when cards are shown or hidden, which resizes the content but not the row. */
export function useShopCarousel(contentKey?: unknown) {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState({ count: 1, current: 0 });

  const measure = useCallback(() => {
    if (!row || row.clientWidth === 0) return;
    const count = Math.max(
      1,
      Math.ceil(row.scrollWidth / row.clientWidth - 0.01)
    );
    const isAtEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
    const current = isAtEnd
      ? count - 1
      : Math.round(row.scrollLeft / row.clientWidth);
    setPages((previous) =>
      previous.count === count && previous.current === current
        ? previous
        : { count, current }
    );
  }, [row]);

  useEffect(() => {
    if (!row) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    row.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener("scroll", measure);
    };
  }, [row, measure]);

  useEffect(() => {
    measure();
  }, [contentKey, measure]);

  const goTo = useCallback(
    (page: number) =>
      row?.scrollTo({ left: page * row.clientWidth, behavior: "smooth" }),
    [row]
  );

  return { rowRef: setRow, pages: { ...pages, goTo } as ShopCarouselPages };
}

export function ShopCarouselDots({
  pages,
  label,
}: Readonly<{ pages: ShopCarouselPages; label: string }>) {
  const { t } = useTranslation("shop");
  if (pages.count <= 1) return null;

  return (
    <span className="shop__dots" role="group" aria-label={label}>
      {Array.from({ length: pages.count }, (_, page) => (
        <button
          key={page}
          type="button"
          className={cn("shop__dot", {
            "shop__dot--active": page === pages.current,
          })}
          aria-label={t("carousel_page", { page: page + 1 })}
          aria-current={page === pages.current}
          onClick={() => pages.goTo(page)}
        />
      ))}
    </span>
  );
}

export function ShopCarouselRow({
  rowRef,
  children,
}: Readonly<{
  rowRef: (row: HTMLDivElement | null) => void;
  children: ReactNode;
}>) {
  return (
    <div ref={rowRef} className="shop__carousel">
      {children}
    </div>
  );
}
