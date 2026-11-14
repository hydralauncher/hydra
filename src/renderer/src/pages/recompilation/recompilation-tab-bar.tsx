import { motion } from "framer-motion";
import cn from "classnames";

export interface RecompilationTab<T extends string> {
  id: T;
  label: string;
  count?: number;
}

const TAB_INDICATOR_SPRING = {
  type: "spring",
  stiffness: 300,
  damping: 30,
} as const;

interface RecompilationTabBarProps<T extends string> {
  tabs: RecompilationTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
}

export function RecompilationTabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
}: Readonly<RecompilationTabBarProps<T>>) {
  return (
    <div className="recompilation-page__tabs" role="tablist">
      {tabs.map((tab) => (
        <div key={tab.id} className="recompilation-page__tab-wrapper">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn("recompilation-page__tab", {
              "recompilation-page__tab--active": activeTab === tab.id,
            })}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {Boolean(tab.count) && (
              <span className="recompilation-page__tab-badge">{tab.count}</span>
            )}
          </button>
          {activeTab === tab.id && (
            <motion.div
              className="recompilation-page__tab-underline"
              layoutId="recompilation-tab-underline"
              transition={TAB_INDICATOR_SPRING}
            />
          )}
        </div>
      ))}
    </div>
  );
}
