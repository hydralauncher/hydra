import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { DotIcon } from "@primer/octicons-react";
import {
  getSkuRegion,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import type { ClassicsDisc } from "@types";
import "./disc-selection-modal.scss";

const REGION_TRANSLATION_KEYS: Record<SkuRegion, string> = {
  US: "region_us",
  EU: "region_eu",
  JP: "region_jp",
  KR: "region_kr",
  ASIA: "region_asia",
};

interface DiscSelectionModalProps {
  visible: boolean;
  discs: ClassicsDisc[];
  defaultDiscPath?: string | null;
  defaultDontAsk?: boolean;
  onClose: () => void;
  onConfirm: (discPath: string, dontAskAgain: boolean) => void;
}

export function DiscSelectionModal({
  visible,
  discs,
  defaultDiscPath,
  defaultDontAsk = false,
  onClose,
  onConfirm,
}: Readonly<DiscSelectionModalProps>) {
  const { t } = useTranslation("game_details");
  const tooltipId = useId();

  const initialSelected = useMemo(
    () => defaultDiscPath ?? discs[0]?.path ?? null,
    [defaultDiscPath, discs]
  );

  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [dontAsk, setDontAsk] = useState(defaultDontAsk);

  useEffect(() => {
    if (visible) {
      setSelected(initialSelected);
      setDontAsk(defaultDontAsk);
    }
  }, [visible, initialSelected, defaultDontAsk]);

  const handleLaunch = () => {
    if (!selected) return;
    onConfirm(selected, dontAsk);
  };

  return (
    <Modal
      visible={visible}
      title={t("select_disc_title")}
      description={t("select_disc_subtitle")}
      onClose={onClose}
    >
      <div className="disc-selection-modal__body">
        {discs.map((disc) => {
          const isActive = selected === disc.path;
          const region = disc.sku ? getSkuRegion(disc.sku) : null;
          const regionName = region ? t(REGION_TRANSLATION_KEYS[region]) : null;
          return (
            <button
              key={disc.path}
              type="button"
              className={`disc-selection-modal__option ${isActive ? "disc-selection-modal__option--active" : ""}`}
              onClick={() => setSelected(disc.path)}
            >
              <DotIcon
                size={20}
                className="disc-selection-modal__option-icon"
              />
              <div className="disc-selection-modal__option-text">
                <span className="disc-selection-modal__option-label">
                  {disc.label}
                </span>
                <span className="disc-selection-modal__option-filename">
                  {disc.fileName}
                </span>
              </div>
              {region && regionName && (
                <img
                  src={getSkuRegionFlag(region)}
                  alt={regionName}
                  className="disc-selection-modal__option-flag"
                  data-tooltip-id={tooltipId}
                  data-tooltip-content={regionName}
                />
              )}
            </button>
          );
        })}
      </div>
      <Tooltip id={tooltipId} />

      <div className="disc-selection-modal__footer">
        <CheckboxField
          label={t("dont_ask_disc_again")}
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
        />
        <Button onClick={handleLaunch} theme="primary" disabled={!selected}>
          {t("launch_game")}
        </Button>
      </div>
    </Modal>
  );
}
