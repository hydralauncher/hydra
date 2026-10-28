import cn from "classnames";
import { UploadIcon } from "@primer/octicons-react";

interface EditProfileTileProps {
  art: React.ReactNode;
  label: string;
  hint?: string;
  /** Small image beside the label, such as a game icon. */
  icon?: string | null;
  isSelected?: boolean;
  isUpload?: boolean;
  isWide?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
}

export function EditProfileTile({
  art,
  label,
  hint,
  icon,
  isSelected = false,
  isUpload = false,
  isWide = false,
  isDisabled = false,
  onClick,
}: Readonly<EditProfileTileProps>) {
  return (
    <button
      type="button"
      className={cn("edit-profile-modal__tile", {
        "edit-profile-modal__tile--selected": isSelected,
        "edit-profile-modal__tile--upload": isUpload,
        "edit-profile-modal__tile--wide": isWide,
      })}
      aria-pressed={isUpload ? undefined : isSelected}
      disabled={isDisabled}
      onClick={onClick}
    >
      <span className="edit-profile-modal__tile-art">{art}</span>
      <span className="edit-profile-modal__tile-label">
        <span className="edit-profile-modal__tile-title">
          {icon && (
            <img src={icon} alt="" className="edit-profile-modal__tile-icon" />
          )}
          <strong>{label}</strong>
        </span>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export function EditProfileUploadTile(
  props: Readonly<Omit<EditProfileTileProps, "art" | "isUpload">>
) {
  return <EditProfileTile {...props} art={<UploadIcon size={20} />} isUpload />;
}
