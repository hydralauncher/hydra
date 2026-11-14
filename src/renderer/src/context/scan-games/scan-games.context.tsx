import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import {
  ScanGamesModal,
  type ScanResult,
} from "@renderer/components/header/scan-games-modal";

export interface ScanGamesContextValue {
  /** Scanning for installed games works on Windows and Linux only. */
  isScanSupported: boolean;
  isScanning: boolean;
  openScanModal: () => void;
}

const ScanGamesContext = createContext<ScanGamesContextValue>({
  isScanSupported: false,
  isScanning: false,
  openScanModal: () => {},
});

export const useScanGames = () => useContext(ScanGamesContext);

const isScanSupported =
  window.electron.platform === "win32" || window.electron.platform === "linux";

/**
 * Owns the scan for installed games above the pages, so a scan and its
 * result survive leaving the library. The scan's notification links back
 * with `?openScanModal=true` to show the result.
 */
export function ScanGamesProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [showScanModal, setShowScanModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);

  const handleStartScan = async (
    additionalDirectories: string[] = [],
    includeDefaultDirectories = true,
    addGamesToLibrary = true
  ) => {
    if (isScanning) return;

    const requestId = crypto.randomUUID();

    setIsScanning(true);
    setScanRequestId(requestId);
    setScanResult(null);

    try {
      const result = await window.electron.scanInstalledGames(
        additionalDirectories,
        includeDefaultDirectories,
        addGamesToLibrary,
        requestId
      );
      setScanResult(result);
    } finally {
      setIsScanning(false);
      setScanRequestId(null);
    }
  };

  const handleCancelScan = () => {
    if (scanRequestId) window.electron.cancelScanInstalledGames(scanRequestId);
  };

  useEffect(() => {
    if (searchParams.get("openScanModal") === "true") {
      setShowScanModal(true);
      searchParams.delete("openScanModal");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openScanModal = useCallback(() => setShowScanModal(true), []);

  const value = useMemo(
    () => ({ isScanSupported, isScanning, openScanModal }),
    [isScanning, openScanModal]
  );

  return (
    <ScanGamesContext.Provider value={value}>
      {children}

      <ScanGamesModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        isScanning={isScanning}
        scanResult={scanResult}
        onStartScan={handleStartScan}
        onCancelScan={handleCancelScan}
        onClearResult={() => setScanResult(null)}
      />
    </ScanGamesContext.Provider>
  );
}
