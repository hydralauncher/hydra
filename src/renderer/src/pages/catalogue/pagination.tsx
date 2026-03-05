import { Button } from "@renderer/components/button/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useFormat } from "@renderer/hooks/use-format";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import "./pagination.scss";

interface JumpControlProps {
  isOpen: boolean;
  value: string;
  totalPages: number;
  inputRef: RefObject<HTMLInputElement>;
  onOpen: () => void;
  onClose: () => void;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

function JumpControl({
  isOpen,
  value,
  totalPages,
  inputRef,
  onOpen,
  onClose,
  onChange,
  onKeyDown,
}: JumpControlProps) {
  return isOpen ? (
    <input
      ref={inputRef}
      type="text"
      min={1}
      max={totalPages}
      inputMode="numeric"
      pattern="[0-9]*"
      className="pagination__page-input"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onClose}
      aria-label="Go to page"
    />
  ) : (
    <Button theme="outline" className="pagination__button" onClick={onOpen}>
      ...
    </Button>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: Readonly<PaginationProps>) {
  const { formatNumber } = useFormat();

  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState<string>("");
  const jumpInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isJumpOpen) {
      setJumpValue("");
      setTimeout(() => jumpInputRef.current?.focus(), 0);
    }
  }, [isJumpOpen, page]);

  if (totalPages <= 1) return null;

  const visiblePages = 3;
  const isLastThree = totalPages > 3 && page >= totalPages - 2;

  let startPage = Math.max(1, page - 1);
  let endPage = startPage + visiblePages - 1;

  if (isLastThree) {
    startPage = Math.max(1, totalPages - 2);
    endPage = totalPages;
  } else if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - visiblePages + 1);
  }

  const onJumpChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digitsOnly = raw.replaceAll(/\D+/g, "");
    if (digitsOnly === "") {
      setJumpValue("");
      return;
    }
    const num = Number.parseInt(digitsOnly, 10);
    if (Number.isNaN(num)) {
      setJumpValue("");
      return;
    }
    if (num < 1) {
      setJumpValue("1");
      return;
    }
    if (num > totalPages) {
      setJumpValue(String(totalPages));
      return;
    }
    setJumpValue(String(num));
  };

  const onJumpKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const controlKeys = [
      "Backspace",
      "Delete",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ];

    if (controlKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
      return;
    }

    if (e.key === "Enter") {
      const sanitized = jumpValue.replaceAll(/\D+/g, "");
      if (sanitized.trim() === "") return;
      const parsed = Number.parseInt(sanitized, 10);
      if (Number.isNaN(parsed)) return;
      const target = Math.max(1, Math.min(totalPages, parsed));
      onPageChange(target);
      setIsJumpOpen(false);
    } else if (e.key === "Escape") {
      setIsJumpOpen(false);
    } else if (!/^\d$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const firstPageTooltip = "Go to first page";
  const previousPageTooltip = "Go to previous page";
  const nextPageTooltip = "Go to next page";
  const lastPageTooltip = "Go to last page";

  return (
    <div className="pagination">
      {startPage > 1 && (
        <Button
          theme="outline"
          onClick={() => onPageChange(1)}
          className="pagination__button"
          tooltip={firstPageTooltip}
          aria-label={firstPageTooltip}
        >
          <ChevronsLeft
            size={18}
            strokeWidth={2.25}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        </Button>
      )}

      <Button
        theme="outline"
        onClick={() => onPageChange(page - 1)}
        className="pagination__button"
        disabled={page === 1}
        tooltip={previousPageTooltip}
        aria-label={previousPageTooltip}
      >
        <ChevronLeft
          size={16}
          strokeWidth={2.25}
          absoluteStrokeWidth
          aria-hidden="true"
        />
      </Button>

      {isLastThree && startPage > 1 && (
        <>
          <Button
            theme="outline"
            className="pagination__button"
            onClick={() => onPageChange(1)}
          >
            {formatNumber(1)}
          </Button>
          <JumpControl
            isOpen={isJumpOpen}
            value={jumpValue}
            totalPages={totalPages}
            inputRef={jumpInputRef}
            onOpen={() => setIsJumpOpen(true)}
            onClose={() => setIsJumpOpen(false)}
            onChange={onJumpChange}
            onKeyDown={onJumpKeyDown}
          />
        </>
      )}

      {Array.from(
        { length: endPage - startPage + 1 },
        (_, i) => startPage + i
      ).map((pageNumber) => (
        <Button
          theme={page === pageNumber ? "primary" : "outline"}
          key={pageNumber}
          className="pagination__button"
          onClick={() => onPageChange(pageNumber)}
        >
          {formatNumber(pageNumber)}
        </Button>
      ))}

      {!isLastThree && page < totalPages - 1 && (
        <>
          <JumpControl
            isOpen={isJumpOpen}
            value={jumpValue}
            totalPages={totalPages}
            inputRef={jumpInputRef}
            onOpen={() => setIsJumpOpen(true)}
            onClose={() => setIsJumpOpen(false)}
            onChange={onJumpChange}
            onKeyDown={onJumpKeyDown}
          />

          <Button
            theme="outline"
            onClick={() => onPageChange(totalPages)}
            className="pagination__button"
            disabled={page === totalPages}
          >
            {formatNumber(totalPages)}
          </Button>
        </>
      )}

      <Button
        theme="outline"
        onClick={() => onPageChange(page + 1)}
        className="pagination__button"
        disabled={page === totalPages}
        tooltip={nextPageTooltip}
        aria-label={nextPageTooltip}
      >
        <ChevronRight
          size={16}
          strokeWidth={2.25}
          absoluteStrokeWidth
          aria-hidden="true"
        />
      </Button>

      {endPage < totalPages && (
        <Button
          theme="outline"
          onClick={() => onPageChange(totalPages)}
          className="pagination__button"
          tooltip={lastPageTooltip}
          aria-label={lastPageTooltip}
        >
          <ChevronsRight
            size={18}
            strokeWidth={2.25}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        </Button>
      )}
    </div>
  );
}
