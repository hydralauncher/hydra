import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import cn from "classnames";

export interface ReleaseRailItem {
  id: string;
  label: string;
  description: string;
}

interface ReleaseRailProps {
  items: ReleaseRailItem[];
  selectedId: string;
  label: string;
  onSelect: (id: string) => void;
}

const ITEM_SIZE = 24;
const TICK_WIDTHS = [48, 32, 20];
const REST_WIDTH = 12;
const TICK_SPRING = { type: "spring", stiffness: 500, damping: 38 } as const;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function ReleaseRail({
  items,
  selectedId,
  label,
  onSelect,
}: Readonly<ReleaseRailProps>) {
  const reduce = useReducedMotion();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const previewIndex = items.findIndex((item) => item.id === hoveredId);
  const preview = previewIndex >= 0 ? items[previewIndex] : null;
  const previewY = previewIndex * ITEM_SIZE + ITEM_SIZE / 2;

  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const clearHover = () => setHoveredId(null);
    nav.addEventListener("pointerleave", clearHover);
    return () => nav.removeEventListener("pointerleave", clearHover);
  }, []);

  return (
    <nav ref={navRef} className="release-rail" aria-label={label}>
      {items.map((item, index) => {
        const isSelected = item.id === selectedId;
        const width =
          previewIndex < 0
            ? REST_WIDTH
            : (TICK_WIDTHS[Math.abs(index - previewIndex)] ?? REST_WIDTH);

        return (
          <button
            key={item.id}
            type="button"
            className={cn("release-rail__item", {
              "release-rail__item--selected": isSelected,
              "release-rail__item--highlighted": index === previewIndex,
            })}
            aria-label={`${item.label}, ${item.description}`}
            aria-current={isSelected ? "true" : undefined}
            tabIndex={-1}
            onPointerEnter={() => setHoveredId(item.id)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(item.id)}
          >
            <motion.span
              className="release-rail__tick"
              initial={false}
              animate={{ width }}
              transition={reduce ? { duration: 0 } : TICK_SPRING}
            />
          </button>
        );
      })}

      <AnimatePresence>
        {preview && (
          <motion.div
            className="release-rail__preview"
            aria-hidden="true"
            initial={{ opacity: 0, y: previewY }}
            animate={{ opacity: 1, y: previewY }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={reduce ? { duration: 0 } : TICK_SPRING}
          >
            <div className="release-rail__preview-card">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={preview.id}
                  className="release-rail__preview-text"
                  initial={
                    reduce
                      ? { opacity: 0 }
                      : { opacity: 0, y: 4, filter: "blur(6px)" }
                  }
                  animate={
                    reduce
                      ? { opacity: 1 }
                      : { opacity: 1, y: 0, filter: "blur(0px)" }
                  }
                  exit={
                    reduce
                      ? { opacity: 0 }
                      : {
                          opacity: 0,
                          y: -2,
                          filter: "blur(4px)",
                          transition: { duration: 0.12, ease: EASE_OUT },
                        }
                  }
                  transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
                >
                  <strong>{preview.label}</strong>
                  <span>{preview.description}</span>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
