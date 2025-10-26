import { Button } from "@renderer/components/button/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useFormat } from "@renderer/hooks/use-format";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import "./pagination.scss";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: PaginationProps) {
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
    const val = e.target.value;
    if (val === "") {
      setJumpValue("");
      return;
    }
    const num = Number(val);
    if (Number.isNaN(num)) {
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
    setJumpValue(val);
  };

  const onJumpKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (jumpValue.trim() === "") return;
      const parsed = Number(jumpValue);
      if (Number.isNaN(parsed)) return;
      const target = Math.max(1, Math.min(totalPages, parsed));
      onPageChange(target);
      setIsJumpOpen(false);
    } else if (e.key === "Escape") {
      setIsJumpOpen(false);
    }
  };

  const JumpControl = () =>
    isJumpOpen ? (
      <input
        ref={jumpInputRef}
        type="number"
        min={1}
        max={totalPages}
        className="pagination__page-input"
        value={jumpValue}
        onChange={onJumpChange}
        onKeyDown={onJumpKeyDown}
        onBlur={() => {
          setIsJumpOpen(false);
        }}
        aria-label="Go to page"
      />
    ) : (
      <Button
        theme="outline"
        className="pagination__button"
        onClick={() => setIsJumpOpen(true)}
      >
        ...
      </Button>
    );

  return (
    <div className="pagination">
      {startPage > 1 && (
        <Button
          theme="outline"
          onClick={() => onPageChange(1)}
          className="pagination__button"
        >
          <span className="pagination__double-chevron">
            <ChevronLeftIcon />
            <ChevronLeftIcon />
          </span>
        </Button>
      )}

      <Button
        theme="outline"
        onClick={() => onPageChange(page - 1)}
        className="pagination__button"
        disabled={page === 1}
      >
        <ChevronLeftIcon />
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
          <JumpControl />
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
          <JumpControl />

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
      >
        <ChevronRightIcon />
      </Button>

      {endPage < totalPages && (
        <Button
          theme="outline"
          onClick={() => onPageChange(totalPages)}
          className="pagination__button"
        >
          <span className="pagination__double-chevron">
            <ChevronRightIcon />
            <ChevronRightIcon />
          </span>
        </Button>
      )}
    </div>
  );
}
