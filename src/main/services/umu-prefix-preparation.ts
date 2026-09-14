export interface UmuPrefixPreparationEvaluation {
  success: boolean;
  acceptedNonZeroExit: boolean;
  errorMessage?: string;
}

export const evaluateUmuPrefixPreparation = (
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  prefixValid: boolean
): UmuPrefixPreparationEvaluation => {
  if (prefixValid) {
    return {
      success: true,
      acceptedNonZeroExit: exitCode !== 0 || signal !== null,
    };
  }

  return {
    success: false,
    acceptedNonZeroExit: false,
    errorMessage: `umu-run prefix preparation left an invalid prefix with code=${exitCode ?? "null"} signal=${signal ?? "null"}`,
  };
};
