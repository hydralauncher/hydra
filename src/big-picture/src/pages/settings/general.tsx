import "./general.scss";

import { PlusCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import {
  Button,
  DropdownSelect,
  type DropdownSelectOption,
  HorizontalFocusGroup,
  UserDiskItem,
  VerticalFocusGroup,
} from "../../components";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

interface DownloadDirectory {
  title: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
}

const DOWNLOAD_DIRECTORIES: Array<DownloadDirectory> = [
  {
    title: "Hydra SSD",
    path: "C:\\Hydra\\Downloads",
    freeBytes: Math.round(512.4 * 1024 ** 3),
    totalBytes: 1 * 1024 ** 4,
  },
  {
    title: "Archive Drive",
    path: "D:\\Games\\Hydra",
    freeBytes: Math.round(183.8 * 1024 ** 3),
    totalBytes: 2 * 1024 ** 4,
  },
  {
    title: "Portable NVMe",
    path: "E:\\Portable\\Downloads",
    freeBytes: Math.round(74.2 * 1024 ** 3),
    totalBytes: 512 * 1024 ** 3,
  },
];

const DEFAULT_DIRECTORY_PATH = DOWNLOAD_DIRECTORIES[0]?.path ?? "";

export function GeneralSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const [selectedDefaultPath, setSelectedDefaultPath] =
    useState(DEFAULT_DIRECTORY_PATH);

  const directoryOptions = useMemo<Array<DropdownSelectOption<string>>>(
    () =>
      DOWNLOAD_DIRECTORIES.map((directory) => ({
        value: directory.path,
        label: directory.title,
      })),
    []
  );

  return (
    <SettingsSection
      title="Downloads Directories"
      description="Choose the default download location and add new directories for future game downloads."
      className={className}
    >
      <HorizontalFocusGroup className="settings-general__controls">
        <DropdownSelect
          className="settings-general__select"
          hideLabel
          value={selectedDefaultPath}
          options={directoryOptions}
          onValueChange={setSelectedDefaultPath}
          ariaLabel="Default download directory"
        />

        <Button
          variant="secondary"
          size="small"
          icon={<PlusCircleIcon size={20} />}
          className="settings-general__add-button"
          onClick={() => {}}
        >
          Add Directory
        </Button>
      </HorizontalFocusGroup>

      <VerticalFocusGroup asChild>
        <div className="settings-general__disks">
          {DOWNLOAD_DIRECTORIES.map((directory) => (
            <UserDiskItem
              key={directory.path}
              title={directory.title}
              path={directory.path}
              freeBytes={directory.freeBytes}
              totalBytes={directory.totalBytes}
              isSelected={selectedDefaultPath === directory.path}
              onClick={() => setSelectedDefaultPath(directory.path)}
              className="settings-general__disk"
            />
          ))}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
