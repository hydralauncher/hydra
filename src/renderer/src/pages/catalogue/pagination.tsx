import { Button } from "@renderer/components/button/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";

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
  if (totalPages <= 1) return null;

  // Number of visible pages
  const visiblePages = 3;

  // Calculate the start and end of the visible range
  let startPage = Math.max(1, page - 1); // Shift range slightly back
  let endPage = startPage + visiblePages - 1;

  // Adjust the range if we're near the start or end
  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - visiblePages + 1);
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
      }}
    >
      {/* Previous Button */}
      <Button
        theme="outline"
        onClick={() => onPageChange(page - 1)}
        style={{ width: 40 }}
        disabled={page === 1}
      >
        <ChevronLeftIcon />
      </Button>

      <div
        style={{
          width: 40,
          justifyContent: "center",
          display: "flex",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 16 }}>...</span>
      </div>

      {/* Page Buttons */}
      {Array.from(
        { length: endPage - startPage + 1 },
        (_, i) => startPage + i
      ).map((pageNumber) => (
        <Button
          theme={page === pageNumber ? "primary" : "outline"}
          key={pageNumber}
          onClick={() => onPageChange(pageNumber)}
        >
          {pageNumber}
        </Button>
      ))}

      {/* Next Button */}
      <Button
        theme="outline"
        onClick={() => onPageChange(page + 1)}
        style={{ width: 40 }}
        disabled={page === totalPages}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
