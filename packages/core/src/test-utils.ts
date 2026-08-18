import { vi } from "vitest";

export interface RpcClientMock {
  readonly instance: ReturnType<ReturnType<typeof createRpcClientMock>["getInstance"]>;
  getInstance(): Record<string, ReturnType<typeof vi.fn>>;
  reset(): void;
  factory(): Record<string, unknown>;
}

export function createRpcClientMock(): RpcClientMock {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      promptAndWait: vi.fn().mockResolvedValue([]),
    };
  }
  reset();

  function MockRpcClientConstructor() {
    return instance;
  }

  return {
    get instance() {
      return instance!;
    },
    getInstance: () => instance!,
    reset,
    factory: (): Record<string, unknown> => ({
      RpcClient: MockRpcClientConstructor,
      ExtensionAPI: class {},
      ExtensionCommandContext: class {},
      ExtensionContext: class {},
    }),
  };
}
