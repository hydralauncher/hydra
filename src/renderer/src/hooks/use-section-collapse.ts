import { useState, useCallback } from "react";

interface SectionCollapseState {
  pinned: boolean;
  library: boolean;
}

export function useSectionCollapse() {
  const [collapseState, setCollapseState] = useState<SectionCollapseState>({
    pinned: false,
    library: false,
  });

  const toggleSection = useCallback(
    (section: keyof SectionCollapseState) => {
      setCollapseState(prevState => ({
        ...prevState,
        [section]: !prevState[section],
      }));
    },
    []
  );

  return {
    collapseState,
    toggleSection,
    isPinnedCollapsed: collapseState.pinned,
    isLibraryCollapsed: collapseState.library,
  };
}