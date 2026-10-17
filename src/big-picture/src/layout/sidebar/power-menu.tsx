import { useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
  MoonIcon,
  PowerIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import type { SystemPowerAction } from "@types";
import { FocusItem, Modal, VerticalFocusGroup } from "../../components/common";
import { ConfirmationModal } from "../../components/modals";
import { IS_DESKTOP } from "../../constants";
import { useBigPictureToast } from "../../hooks";
import "./power-menu.scss";

const POWER_OPTIONS = [
  {
    action: "suspend",
    label: "Suspend",
    subtitle: "Put the system to sleep",
    title: "Suspend the system?",
    description:
      "The system will sleep. Downloads will pause until it wakes up.",
    icon: MoonIcon,
  },
  {
    action: "restart",
    label: "Restart",
    subtitle: "Restart your device",
    title: "Restart the system?",
    description:
      "The system will restart. Save your game and any open work before continuing.",
    icon: ArrowClockwiseIcon,
  },
  {
    action: "power-off",
    label: "Power Off",
    subtitle: "Shut down your device",
    title: "Power off the system?",
    description:
      "The system will shut down. Save your game and any open work before continuing.",
    icon: PowerIcon,
  },
] as const;

interface PowerMenuProps {
  visible: boolean;
  onClose: () => void;
  onExitBigPicture: () => void;
}

export function PowerMenu({
  visible,
  onClose,
  onExitBigPicture,
}: Readonly<PowerMenuProps>) {
  const [selectedAction, setSelectedAction] =
    useState<SystemPowerAction | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingRef = useRef(false);
  const { showErrorToast } = useBigPictureToast();
  const selectedOption = POWER_OPTIONS.find(
    (option) => option.action === selectedAction
  );
  const canControlSystem =
    IS_DESKTOP &&
    ["win32", "linux", "darwin"].includes(globalThis.window.electron.platform);

  const closeConfirmation = () => {
    if (!pendingRef.current) setSelectedAction(null);
  };

  const confirmAction = async () => {
    if (!selectedAction || !canControlSystem || pendingRef.current) return;

    pendingRef.current = true;
    setLoading(true);
    try {
      await globalThis.window.electron.executeSystemPowerAction(selectedAction);
      setSelectedAction(null);
      onClose();
    } catch {
      setSelectedAction(null);
      showErrorToast("Could not change the system power state", {
        message:
          "The system may have blocked the request or require additional permissions.",
      });
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        onClose={() => {
          if (selectedAction || pendingRef.current) return;
          onClose();
        }}
        title="Power"
        description="Choose what to do with Hydra or your system."
        initialFocusId="big-picture-power-exit"
        className="power-menu"
        backdropClassName="power-menu-backdrop"
        closeOnBackdrop={false}
      >
        <VerticalFocusGroup
          regionId="big-picture-power-options"
          className="power-menu__options"
          style={{ gap: 4 }}
        >
          <PowerMenuOption
            focusId="big-picture-power-exit"
            label="Exit Big Picture"
            subtitle="Return to desktop mode"
            icon={SignOutIcon}
            onClick={() => {
              onClose();
              onExitBigPicture();
            }}
          />
          {POWER_OPTIONS.map((option) => (
            <PowerMenuOption
              key={option.action}
              focusId={`big-picture-power-${option.action}`}
              label={option.label}
              subtitle={option.subtitle}
              icon={option.icon}
              danger={option.action === "power-off"}
              disabled={!canControlSystem}
              onClick={() => setSelectedAction(option.action)}
            />
          ))}
        </VerticalFocusGroup>
      </Modal>
      {selectedOption && (
        <ConfirmationModal
          visible={visible}
          title={selectedOption.title}
          description={selectedOption.description}
          confirmLabel={selectedOption.label}
          onClose={closeConfirmation}
          onConfirm={confirmAction}
          loading={loading}
          danger={selectedAction !== "suspend"}
          backdropClassName="power-menu-confirmation-backdrop"
        />
      )}
    </>
  );
}

function PowerMenuOption({
  focusId,
  label,
  subtitle,
  icon: Icon,
  disabled = false,
  danger = false,
  onClick,
}: Readonly<{
  focusId: string;
  label: string;
  subtitle: string;
  icon: typeof PowerIcon;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}>) {
  return (
    <FocusItem
      id={focusId}
      navigationState={disabled ? "disabled" : "active"}
      actions={{ primary: onClick }}
      asChild
    >
      <button
        type="button"
        className="power-menu__option"
        data-danger={danger || undefined}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        aria-describedby={`${focusId}-description`}
      >
        <span className="power-menu__icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <span className="power-menu__copy">
          <span className="power-menu__label">{label}</span>
          <span className="power-menu__subtitle" id={`${focusId}-description`}>
            {subtitle}
          </span>
        </span>
        <CaretRightIcon className="power-menu__chevron" size={16} aria-hidden />
      </button>
    </FocusItem>
  );
}
