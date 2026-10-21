import { useEffect, useState } from "react";

import { NavigationService } from "../services";

export function useIsLayerOnTop(layerId: string | null) {
  const [activeLayerId, setActiveLayerId] = useState(() =>
    NavigationService.getInstance().getActiveLayerId()
  );

  useEffect(() => {
    const navigation = NavigationService.getInstance();
    const update = () => setActiveLayerId(navigation.getActiveLayerId());

    update();
    return navigation.subscribe(update);
  }, []);

  return layerId !== null && activeLayerId === layerId;
}
