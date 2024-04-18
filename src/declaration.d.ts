declare module "tasklist" {
  interface Task {
    imageName: string;
    pid: number;
    sessionName: string;
    sessionNumber: number;
    memUsage: number;
  }

  function tasklist(): Promise<Task[]>;

  export { tasklist };
}
