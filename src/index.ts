import { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const featureForgeExtension: ExtensionFactory = (pi) => {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("Feature Forge extension loaded!", "info");
  });
};

export default featureForgeExtension;
