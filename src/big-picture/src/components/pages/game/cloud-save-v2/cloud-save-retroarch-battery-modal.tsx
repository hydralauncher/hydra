import { useTranslation } from "react-i18next";

import { Button, Modal, VerticalFocusGroup } from "../../../common";

interface BatteryChoice {
  key: string;
  label: string;
}

interface BigPictureRetroArchBatteryModalProps {
  choices: BatteryChoice[];
  legacy: boolean;
  isBusy: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
}

export function BigPictureRetroArchBatteryModal({
  choices,
  legacy,
  isBusy,
  onClose,
  onSelect,
}: Readonly<BigPictureRetroArchBatteryModalProps>) {
  const { t } = useTranslation("game_details");
  return (
    <Modal
      visible={choices.length > 0}
      title={t(
        legacy
          ? "cloud_save_v2_legacy_battery_conflict_title"
          : "cloud_save_v2_local_battery_conflict_title"
      )}
      description={t(
        legacy
          ? "cloud_save_v2_legacy_battery_conflict_description"
          : "cloud_save_v2_local_battery_conflict_description"
      )}
      onClose={onClose}
    >
      <VerticalFocusGroup
        className="big-picture-cloud-save__battery-choices"
        regionId="big-picture-retroarch-battery-choices"
      >
        {choices.map((choice, index) => (
          <Button
            key={choice.key}
            focusId={`big-picture-retroarch-battery-${index}`}
            disabled={isBusy}
            onClick={() => onSelect(choice.key)}
          >
            {choice.label}
          </Button>
        ))}
      </VerticalFocusGroup>
    </Modal>
  );
}
