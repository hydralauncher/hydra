import { useRef, useState } from "react";
import cn from "classnames";
import * as styles from "./drop-down-menu.css";
import { useOnClickOutside } from "@renderer/hooks";

export interface Option {
  label: string;
  value: string;
  disabled?: boolean;
}

export type SelectedOption = Option;

type DropDownMenuProps = {
  trigger?: React.ReactNode;
  options: Option[];
  onSelect: (value: string) => void;
  defaultOption?: SelectedOption;
  align?: "start" | "end";
  label?: string;
  className?: string;
  classNameTrigger?: string;
};

export function DropDownMenu({
  options,
  trigger,
  onSelect,
  defaultOption,
  align = "start",
  className,
  classNameTrigger,
}: DropDownMenuProps) {
  const menuListRef = useRef<HTMLUListElement | null>(null);
  const [showList, setShowList] = useState<boolean>(false);
  const [selectedOption, setSelectedOption] = useState<Option>(
    defaultOption || options[0]
  );

  const handleToggleList = () => {
    setShowList((prev) => !prev);
  };

  const handleKeyDownList = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleToggleList();
    }
  };

  const handleKeyDownOption = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleToggleList();
    }
  };

  const handleSelectOption = (option: Option) => {
    setSelectedOption(option);
    onSelect(option.value);
    setShowList(false);
  };

  const handleClickOutside = () => {
    setShowList(false);
  };

  useOnClickOutside(menuListRef, handleClickOutside);

  return (
    <div className={cn(styles.dropDownMenu, className)}>
      <div
        role="button"
        tabIndex={0}
        className={cn(styles.dropDownMenuTrigger, classNameTrigger)}
        onClick={handleToggleList}
        onKeyDown={handleKeyDownList}
      >
        {trigger || selectedOption.label}
      </div>

      {showList && (
        <ul
          ref={menuListRef}
          role="listbox"
          tabIndex={0}
          className={cn(styles.dropDownMenuList, {
            [styles.dropDownMenuListStart]: align === "start",
            [styles.dropDownMenuListEnd]: align === "end",
          })}
        >
          {options.map((op, inx) => (
            <li key={inx}>
              <button
                tabIndex={0}
                onClick={() => handleSelectOption(op)}
                onKeyDown={handleKeyDownOption}
                className={cn(styles.dropDownMenuOption, {
                  [styles.dropDownMenuOptionSelected]:
                    op.value === selectedOption.value,
                  [styles.dropDownMenuOptionDisabled]: op.disabled,
                })}
              >
                {op.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
