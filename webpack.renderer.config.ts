import { VanillaExtractPlugin } from "@vanilla-extract/webpack-plugin";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import type { Configuration } from "webpack";

import { plugins } from "./webpack.plugins";
import { rules } from "./webpack.rules";

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
  plugins: [...plugins, new VanillaExtractPlugin()],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
    plugins: [new TsconfigPathsPlugin()],
    fallback: {
      tty: require.resolve("tty-browserify"),
      util: require.resolve("util/"),
    },
  },
};
