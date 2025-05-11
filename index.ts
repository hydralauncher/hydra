import vdf from "vdf-parser";
import fs from "node:fs";

const vdfData = fs.readFileSync(
  "/home/chubby/.local/share/Steam/userdata/1126196664/config/localconfig.vdf",
  "utf-8"
);
const data = vdf.parse(vdfData);

console.log(data);
