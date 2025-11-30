import xdg from "xdg-app-paths";

const options = {
  name: "hydra",
  isolated: true,
};

export class XDGPath {
  static readonly paths = {
    config: "config",
    data: "data",
    cache: "cache",
  };

  static getPath(pathName: keyof typeof XDGPath.paths): string {
    const xdgPaths = xdg(options);
    return xdgPaths[pathName]();
  }
}
