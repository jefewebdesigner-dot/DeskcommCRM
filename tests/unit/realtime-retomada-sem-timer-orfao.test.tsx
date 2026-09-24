import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  prepareRealtimeAuthentication: mock.prepare,
}));

import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mock.prepare.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

it("desmontar cancela o polling e nao deixa timer orfao", async () => {
  const onChange = vi.fn();
  const { unmount } = renderHook(() =>
    useRealtimeChannel({ name: "voice-calls", onChange }),
  );

  await act(async () => {});
  expect(onChange).toHaveBeenCalledTimes(1);

  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(onChange).toHaveBeenCalledTimes(1);
});

it("polling nao dispara enquanto a aba esta oculta", async () => {
  const onChange = vi.fn();
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });

  const { unmount } = renderHook(() =>
    useRealtimeChannel({ name: "inbox", onChange }),
  );
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });
  expect(onChange).not.toHaveBeenCalled();

  if (original) Object.defineProperty(document, "visibilityState", original);
  unmount();
});