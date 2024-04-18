import Dotenv from "dotenv-webpack";
import { sentryWebpackPlugin } from "@sentry/webpack-plugin";
import type IForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: "webpack-infrastructure",
  }),
  new Dotenv({
    path: "./.env",
    safe: false,
    systemvars: true,
  }),
  sentryWebpackPlugin({
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: "hydra-launcher",
    project: "hydra-launcher",
  }),
];
