export const isWindowsBatchFile = (command: string) =>
  /\.(bat|cmd)$/i.test(command);

export const buildWindowsBatchCommand = (command: string, args: string[]) =>
  [command, ...args]
    .map((value) => `"${value.replaceAll('"', '""')}"`)
    .join(" ");
