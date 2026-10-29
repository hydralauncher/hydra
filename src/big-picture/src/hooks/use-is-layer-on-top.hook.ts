import { useEffect, useState } from "react";

import { NavigationService } from "../services";

export function useActiveLayerId() {
  const [activeLayerId, setActiveLayerId] = useState(() =>
    NavigationService.getInstance().getActiveLayerId()
  );

  useEffect(() => {
    const navigation = NavigationService.getInstance();
    const update = () => setActiveLayerId(navigation.getActiveLayerId());

    update();
    return navigation.subscribe(update);
  }, []);

  return activeLayerId;
}

export function useIsLayerOnTop(layerId: string | null) {
  const activeLayerId = useActiveLayerId();
  return layerId !== null && activeLayerId === layerId;
}
