import "./styles.scss";

import {
  CheckCircleIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import { Modal } from "../modal";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { FocusItem } from "../focus-item";
import { EmptyState } from "../empty-state";
import { Skeleton } from "../skeleton";
import { getEntryIcon } from "../../../helpers";
import { getEntryMeta } from "./utils";
import {
  useFileExplorer,
  type FileExplorerModalProps,
} from "./use-file-explorer";

export { type FileExplorerModalProps } from "./use-file-explorer";
export { type FileFilter } from "./utils";

export function FileExplorerModal(props: Readonly<FileExplorerModalProps>) {
  const vm = useFileExplorer(props);

  return (
    <Modal
      visible={props.visible}
      onClose={props.onClose}
      onBack={vm.hasParent ? vm.goToParent : undefined}
      title={props.title}
      closeOnB={false}
      closeOnEscape={false}
      className="file-explorer-modal"
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
          <VerticalFocusGroup
            regionId={vm.fileListRegionId}
            className="file-explorer__list"
          >
            <div className="file-explorer__path-input-wrapper">
              <FocusItem
                stealFocusOnAppear
                actions={{ primary: () => vm.pathInputRef.current?.focus() }}
              >
                <input
                  ref={vm.pathInputRef}
                  className="file-explorer__path-input"
                  type="text"
                  placeholder={vm.currentPath || vm.PATH_INPUT_PLACEHOLDER}
                  value={vm.pathInputValue}
                  onChange={(e) => vm.setPathInputValue(e.target.value)}
                  onKeyDown={vm.handlePathInputKeyDown}
                />
              </FocusItem>

              <FolderOpenIcon
                size={24}
                weight="fill"
                className="file-explorer__path-input-icon"
              />
            </div>

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

                  <span>Select this directory</span>
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
