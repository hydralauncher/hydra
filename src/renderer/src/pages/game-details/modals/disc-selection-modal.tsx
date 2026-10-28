import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { FileIcon } from "@primer/octicons-react";
import { Disc3 } from "lucide-react";
import { getClassicsDiscLabel } from "@shared";
import { useFileIcons } from "@renderer/hooks/use-file-icons";
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

  const executableIcons = useFileIcons(
    discs.filter((disc) => disc.isExecutable).map((disc) => disc.path)
  );

  const sortedDiscs = useMemo(() => {
    const regionOrder = new Map<string, number>();
    for (const disc of discs) {
      const region = disc.sku ? getSkuRegion(disc.sku) : null;
      if (region && !regionOrder.has(region)) {
        regionOrder.set(region, regionOrder.size);
      }
    }

    const rankOf = (disc: ClassicsDisc): number => {
      const region = disc.sku ? getSkuRegion(disc.sku) : null;
      if (!region) return Number.MAX_SAFE_INTEGER;
      return regionOrder.get(region) ?? Number.MAX_SAFE_INTEGER;
    };

    const numberOf = (disc: ClassicsDisc): number => {
      if (disc.isExecutable) return Number.MAX_SAFE_INTEGER;
      const match = /\d+/.exec(disc.label);
      return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
    };

    return [...discs].sort(
      (a, b) => rankOf(a) - rankOf(b) || numberOf(a) - numberOf(b)
    );
  }, [discs]);

  const initialSelected = useMemo(
    () => defaultDiscPath ?? sortedDiscs[0]?.path ?? null,
    [defaultDiscPath, sortedDiscs]
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

  const renderOptionIcon = (disc: ClassicsDisc) => {
    if (!disc.isExecutable) {
      return <Disc3 size={20} className="disc-selection-modal__option-icon" />;
    }

    const fileIcon = executableIcons[disc.path];

    return fileIcon ? (
      <img
        src={fileIcon}
        alt=""
        width={20}
        height={20}
        className="disc-selection-modal__option-icon"
      />
    ) : (
      <FileIcon size={20} className="disc-selection-modal__option-icon" />
    );
  };

  return (
    <Modal
      visible={visible}
      title={t("select_disc_title")}
      description={t("select_disc_subtitle")}
      onClose={onClose}
    >
      <div className="disc-selection-modal__body">
        {sortedDiscs.map((disc) => {
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
              {renderOptionIcon(disc)}
              <div className="disc-selection-modal__option-text">
                <span className="disc-selection-modal__option-label">
                  {getClassicsDiscLabel(disc)}
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
