import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { activateSpecResolution } from "../../src/extensions/spec-resolution";

/**
 * Inline extension fixture for the in-process interceptor integration test.
 *
 * Wires the real child-side spec resolution (FORGE_SPEC → tool restrictions)
 * through pi's real extension loader, API, and ExtensionRunner dispatch.
 */
const extensionFactory: ExtensionFactory = (pi) => {
  activateSpecResolution(pi);
};

export default extensionFactory;
