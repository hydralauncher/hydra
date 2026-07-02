import "./styles.scss";

import {
  CheckCircleIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Modal } from "../modal";
import { Tabs, type TabsItem } from "../tabs";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { EmptyState } from "../empty-state";
import { Skeleton } from "../skeleton";
import { getEntryIcon } from "../../../helpers";
import { getEntryMeta } from "./utils";
import {
  useFileExplorer,
  type FileExplorerModalProps,
} from "./use-file-explorer";
import { FocusItem } from "../focus-item";

export { type FileExplorerModalProps } from "./use-file-explorer";
export { type FileFilter } from "./utils";

function getDriveFocusId(drive: string) {
  return `file-explorer-drive-${drive}`;
}

function getEntryFocusId(path: string) {
  return `file-explorer-entry-${path}`;
}

function getInitialFocusId(vm: ReturnType<typeof useFileExplorer>) {
  const firstDrive = vm.drives[0];
  const firstEntry = vm.filteredEntries[0];
  const firstFilterTab = vm.filterTabItems[0];

  if (vm.showSelectThisDir) {
    return "file-explorer-select-dir";
  }

  if (vm.showDriveList && firstDrive) {
    return getDriveFocusId(firstDrive);
  }

  if (firstEntry) {
    return getEntryFocusId(firstEntry.path);
  }

  if (vm.shouldShowFilterTabs && firstFilterTab) {
    return firstFilterTab.id;
  }

  return undefined;
}

export function FileExplorerModal(props: Readonly<FileExplorerModalProps>) {
  const { t } = useTranslation("big_picture");
  const vm = useFileExplorer(props);
  const initialFocusId = getInitialFocusId(vm);
  const filterTabItems = vm.filterTabItems as Array<TabsItem<string>>;

  return (
    <Modal
      visible={props.visible}
      onClose={props.onClose}
      onBack={vm.hasParent ? vm.goToParent : undefined}
      title={props.title}
      closeOnB={false}
      closeOnEscape={false}
      className="file-explorer-modal"
      initialFocusId={initialFocusId}
    >
      <div className="file-explorer">
        {vm.isLoading && (
          <div className="file-explorer__list">
            <div className="file-explorer__skeleton-group">
              {Array.from({ length: vm.SKELETON_COUNT }, (_, i) => (
                <Skeleton key={i} className="file-explorer__skeleton" />
              ))}
            </div>
          </div>
        )}

        {vm.error && (
          <div className="file-explorer__list">
            <div className="file-explorer__status file-explorer__status--error">
              {vm.error}
            </div>
          </div>
        )}

        {!vm.isLoading && !vm.error && (
          <div className="file-explorer__path-input-wrapper">
            <input
              className="file-explorer__path-input"
              type="text"
              placeholder={vm.currentPath || vm.PATH_INPUT_PLACEHOLDER}
              value={vm.currentPath}
              readOnly
              tabIndex={-1}
              aria-readonly="true"
            />

            <FolderOpenIcon
              size={24}
              weight="fill"
              className="file-explorer__path-input-icon"
            />
          </div>
        )}

        {!vm.isLoading && !vm.error && (
          <VerticalFocusGroup
            regionId={vm.fileListRegionId}
            className="file-explorer__list"
          >
            {vm.shouldShowFilterTabs && (
              <div className="file-explorer__filters">
                <Tabs
                  items={filterTabItems}
                  value={vm.activeFilterId ?? undefined}
                  onValueChange={vm.selectFilter}
                  variant="segmented"
                  ariaLabel={vm.filterLabel}
                  className="file-explorer__filter-tabs"
                />
              </div>
            )}

            {vm.showSelectThisDir && (
              <FocusItem
                id="file-explorer-select-dir"
                actions={{ primary: vm.handleSelectThisDirectory }}
                asChild
              >
                <button
                  className="file-explorer__item file-explorer__item--select-dir"
                  onClick={vm.handleSelectThisDirectory}
                >
                  <span className="file-explorer__item-icon">
                    <CheckCircleIcon size={22} weight="fill" />
                  </span>

                  <span>{t("file_explorer_select_this_directory")}</span>
                </button>
              </FocusItem>
            )}

            {vm.showDriveList && (
              <>
                <div className="file-explorer__section-label">
                  {vm.DRIVES_LABEL}
                </div>

                {vm.drives.map((drive) => (
                  <FocusItem
                    key={drive}
                    id={getDriveFocusId(drive)}
                    actions={{ primary: () => vm.navigateToDrive(drive) }}
                    asChild
                  >
                    <button
                      className="file-explorer__item"
                      onClick={() => vm.navigateToDrive(drive)}
                    >
                      <FolderIcon size={22} weight="fill" />
                      <span>{drive}</span>
                    </button>
                  </FocusItem>
                ))}
              </>
            )}

            {vm.filteredEntries.length === 0 &&
              !vm.showDriveList &&
              !vm.isLoading && (
                <EmptyState
                  className="file-explorer__empty"
                  icon={<FolderOpenIcon size={32} weight="fill" />}
                  title={vm.emptyTitle}
                />
              )}

            {vm.filteredEntries.map((entry) => (
              <FocusItem
                key={entry.path}
                id={getEntryFocusId(entry.path)}
                actions={{ primary: () => vm.handleEntrySelect(entry) }}
                asChild
              >
                <button
                  className="file-explorer__item"
                  onClick={() => vm.handleEntrySelect(entry)}
                >
                  <span className="file-explorer__item-icon">
                    {getEntryIcon(entry)}
                  </span>
                  <span className="file-explorer__item-name">{entry.name}</span>
                  <span className="file-explorer__item-meta">
                    {getEntryMeta(entry)}
                  </span>
                </button>
              </FocusItem>
            ))}
          </VerticalFocusGroup>
        )}
      </div>
    </Modal>
  );
}
