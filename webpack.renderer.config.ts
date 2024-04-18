import type { Configuration } from "webpack";
import { VanillaExtractPlugin } from "@vanilla-extract/webpack-plugin";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

rules.push({
  test: /\.svg$/,
  use: ["@svgr/webpack"],
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  devtool: "source-map",
  plugins: [...plugins, new VanillaExtractPlugin()],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
    plugins: [new TsconfigPathsPlugin()],
  },
};
