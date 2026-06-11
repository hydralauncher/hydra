import type { ClassicsDisc } from "@types";
import {
  getSkuRegion,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Button, FocusItem, HorizontalFocusGroup, Modal } from "../../common";

import "./styles.scss";

const DISC_SELECTION_ACTIONS_REGION_ID = "disc-selection-modal-actions";
const DISC_SELECTION_DONT_ASK_ID = "disc-selection-modal-dont-ask";
const DISC_SELECTION_LAUNCH_ID = "disc-selection-modal-launch";

const REGION_LABELS: Record<SkuRegion, string> = {
  US: "United States",
  EU: "Europe",
  JP: "Japan",
  KR: "Korea",
  ASIA: "Asia",
};

function getDiscFocusId(path: string) {
  return `disc-selection-modal-disc:${path}`;
}

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
      const match = /\d+/.exec(disc.label);
      return match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
    };

    return [...discs].sort(
      (a, b) => rankOf(a) - rankOf(b) || numberOf(a) - numberOf(b)
    );
  }, [discs]);

  const initialSelected = useMemo(
    () => defaultDiscPath ?? sortedDiscs[0]?.path ?? null,
    [defaultDiscPath, sortedDiscs]
  );

  const [selectedDiscPath, setSelectedDiscPath] = useState<string | null>(
    initialSelected
  );
  const [dontAskAgain, setDontAskAgain] = useState(defaultDontAsk);

  useEffect(() => {
    if (!visible) return;

    setSelectedDiscPath(initialSelected);
    setDontAskAgain(defaultDontAsk);
  }, [defaultDontAsk, initialSelected, visible]);

  const handleLaunch = () => {
    if (!selectedDiscPath) return;
    onConfirm(selectedDiscPath, dontAskAgain);
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Select disc"
      description="Choose which disc to launch for this Classics game."
      className="disc-selection-modal"
    >
      <div className="disc-selection-modal__content">
        <div
          className="disc-selection-modal__list"
          role="radiogroup"
          aria-label="Available discs"
        >
          {sortedDiscs.map((disc) => {
            const isSelected = selectedDiscPath === disc.path;
            const region = disc.sku ? getSkuRegion(disc.sku) : null;

            return (
              <FocusItem
                key={disc.path}
                id={getDiscFocusId(disc.path)}
                actions={{ primary: () => setSelectedDiscPath(disc.path) }}
                asChild
              >
                <button
                  type="button"
                  className="disc-selection-modal__disc"
                  data-selected={isSelected}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedDiscPath(disc.path)}
                >
                  <span className="disc-selection-modal__disc-icon">
                    {isSelected ? (
                      <CheckCircleIcon size={22} weight="fill" />
                    ) : (
                      <CircleIcon size={22} />
                    )}
                  </span>

                  <span className="disc-selection-modal__disc-text">
                    <span className="disc-selection-modal__disc-label">
                      {disc.label}
                    </span>
                    <span className="disc-selection-modal__disc-file">
                      {disc.fileName}
                    </span>
                  </span>

                  {region ? (
                    <img
                      className="disc-selection-modal__disc-region"
                      src={getSkuRegionFlag(region)}
                      alt={REGION_LABELS[region]}
                      title={REGION_LABELS[region]}
                    />
                  ) : null}
                </button>
              </FocusItem>
            );
          })}
        </div>

        <HorizontalFocusGroup
          regionId={DISC_SELECTION_ACTIONS_REGION_ID}
          className="disc-selection-modal__actions"
        >
          <FocusItem
            id={DISC_SELECTION_DONT_ASK_ID}
            actions={{ primary: () => setDontAskAgain((value) => !value) }}
            asChild
          >
            <button
              type="button"
              className="disc-selection-modal__dont-ask"
              aria-pressed={dontAskAgain}
              data-selected={dontAskAgain}
              onClick={() => setDontAskAgain((value) => !value)}
            >
              <span className="disc-selection-modal__dont-ask-box">
                {dontAskAgain ? (
                  <CheckCircleIcon size={18} weight="fill" />
                ) : null}
              </span>
              Don&apos;t ask again
            </button>
          </FocusItem>

          <Button
            focusId={DISC_SELECTION_LAUNCH_ID}
            disabled={!selectedDiscPath}
            onClick={handleLaunch}
          >
            Launch
          </Button>
        </HorizontalFocusGroup>
      </div>
    </Modal>
  );
}
