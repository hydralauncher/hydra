import psList from "ps-list";
import { tasklist } from "tasklist";

export const getProcesses = async () => {
  if (process.platform === "win32") {
    return tasklist().then((tasks) =>
      tasks.map((task) => ({ ...task, name: task.imageName }))
    );
  }

  return psList();
};
