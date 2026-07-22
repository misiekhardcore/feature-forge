import { ForgeConfig } from "@feature-forge/shared";

// Initialize ForgeConfig with built-in defaults before any test runs.
// This ensures that modules calling ForgeConfig.getInstance() at import
// time (Logger, FileLogger, AgentViewerOverlay helpers) do not throw.
await ForgeConfig.create();
