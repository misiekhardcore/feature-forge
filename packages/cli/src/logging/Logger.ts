/**
 * Re-export the shared Logger so CLI consumers remain unaffected.
 *
 * During CLI start-up the default log level is wired from ForgeConfig so
 * the entire monorepo (including @feature-forge/tui) honours the same
 * threshold.
 */

export { DEFAULT_LOG_LEVEL, Logger, LogLevel, shouldLog } from "@feature-forge/shared";

import { Logger, logger } from "@feature-forge/shared";

import { ForgeConfig } from "../config";

Logger.setDefaultLogLevel(ForgeConfig.getInstance().getLogLevel());

export { logger };
