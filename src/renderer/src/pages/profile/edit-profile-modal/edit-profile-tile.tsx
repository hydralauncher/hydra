import cn from "classnames";
import { UploadIcon } from "@primer/octicons-react";

interface EditProfileTileProps {
  art: React.ReactNode;
  label: string;
  hint?: string;
  isSelected?: boolean;
  isUpload?: boolean;
  isWide?: boolean;
  onClick: () => void;
}

export function EditProfileTile({
  art,
  label,
  hint,
  isSelected = false,
  isUpload = false,
  isWide = false,
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
      onClick={onClick}
    >
      <span className="edit-profile-modal__tile-art">{art}</span>
      <span className="edit-profile-modal__tile-label">
        <strong>{label}</strong>
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
