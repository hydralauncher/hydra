import psList from "ps-list";

export const getProcesses = async () => {
  return psList();
};
