import { ForgeConfig } from "./config";

// Initialize ForgeConfig with built-in defaults before any test runs.
// This ensures that modules calling ForgeConfig.getInstance() at import
// time (Logger, FileLogger, AgentViewerOverlay helpers) do not throw.
await ForgeConfig.create();

// Wire the shared Logger's default log level from ForgeConfig so the
// entire monorepo (including @feature-forge/tui) honours the same
// threshold.
import { Logger } from "@feature-forge/shared";

Logger.setDefaultLogLevel(ForgeConfig.getInstance().getLogLevel());
