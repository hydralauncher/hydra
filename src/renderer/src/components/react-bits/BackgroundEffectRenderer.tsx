import React, { useEffect, useState, memo } from "react";
import DarkVeil from "./DarkVeil/DarkVeil";
import LightPillar from "./LightPillar/LightPillar";
import FloatingLines from "./FloatingLines/FloatingLines";
import LightRays from "./LightRays/LightRays";
import ColorBends from "./ColorBends/ColorBends";
import Particles from "./Particles/Particles";
import Beams from "./Beams/Beams";
import PixelBlast from "../PixelBlast/PixelBlast";
import { useLocation } from "react-router-dom";
import { effectsInfo } from "../../pages/settings/appearance/background-effect-settings";

export const BackgroundEffectRenderer = memo(
  function BackgroundEffectRenderer() {
    const [effect, setEffect] = useState<string>("floatinglines");
    const [config, setConfig] = useState<any>({});
    const location = useLocation();

    const isHiddenRoute = location.pathname.startsWith("/game/");

    useEffect(() => {
      const handleUpdate = () => {
        const currentEffect =
          localStorage.getItem("hydra_background_effect") || "floatinglines";
        setEffect(currentEffect);
        try {
          const confStr = localStorage.getItem("hydra_background_config");
          const parsed = confStr ? JSON.parse(confStr) : {};

          const defaultConf = effectsInfo[currentEffect]?.defaults || {};

          if (Object.keys(parsed).length === 0) {
            setConfig(defaultConf);
          } else {
            setConfig({ ...defaultConf, ...parsed });
          }
        } catch (e) {
          setConfig(effectsInfo[currentEffect]?.defaults || {});
        }
      };

      handleUpdate();

      window.addEventListener("background_effect_update", handleUpdate);
      return () =>
        window.removeEventListener("background_effect_update", handleUpdate);
    }, []);

    if (effect === "none" || isHiddenRoute) return null;

    const renderEffect = () => {
      switch (effect) {
        case "darkveil":
          return <DarkVeil {...config} />;
        case "lightpillar":
          return <LightPillar {...config} />;
        case "floatinglines":
          return <FloatingLines {...config} />;
        case "lightrays":
          return <LightRays {...config} />;
        case "colorbends":
          return <ColorBends {...config} />;
        case "particles":
          return <Particles {...config} />;
        case "beams":
          return <Beams {...config} />;
        case "pixelblast":
          return <PixelBlast {...config} />;
        default:
          return null;
      }
    };

    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: -1,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <ErrorBoundary fallback={null}>{renderEffect()}</ErrorBoundary>
      </div>
    );
  }
);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("Background effect error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
