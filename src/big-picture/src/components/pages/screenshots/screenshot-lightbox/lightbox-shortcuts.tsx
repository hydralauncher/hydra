import { useIsLayerOnTop, useNavigationScreenActions } from "../../../../hooks";

interface LightboxBackActionProps {
  enabled: boolean;
  layerId: string | null;
  isActiveLayer: () => boolean;
  onClose: () => void;
}

export function LightboxBackAction({
  enabled,
  layerId,
  isActiveLayer,
  onClose,
}: Readonly<LightboxBackActionProps>) {
  const isOnTop = useIsLayerOnTop(layerId);
  useNavigationScreenActions(
    enabled && isOnTop
      ? {
          press: {
            b: () => {
              if (isActiveLayer()) onClose();
            },
          },
        }
      : {}
  );

  return null;
}
