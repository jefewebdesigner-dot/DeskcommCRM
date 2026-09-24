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

it("nenhuma reconciliacao acontece antes de a sessao Neon estar pronta", async () => {
  let release!: () => void;
  mock.prepare.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const onChange = vi.fn();
  const { result, unmount } = renderHook(() =>
    useRealtimeChannel({ name: "org-A", onChange }),
  );

  expect(result.current.status).toBe("connecting");
  expect(onChange).not.toHaveBeenCalled();

  await act(async () => release());

  expect(result.current.status).toBe("subscribed");
  expect(onChange).toHaveBeenCalledWith({
    tipo: "reassinado",
    source: "neon-poll",
  });
  unmount();
});

it("sessao tardia de tela desmontada nao inicia polling", async () => {
  let release!: () => void;
  mock.prepare.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const onChange = vi.fn();
  const { unmount } = renderHook(() =>
    useRealtimeChannel({ name: "org-A", onChange }),
  );
  unmount();

  await act(async () => release());
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(onChange).not.toHaveBeenCalled();
});

it("falha de auth nao reconcilia anon e tenta novamente", async () => {
  mock.prepare
    .mockRejectedValueOnce(new Error("sem token"))
    .mockResolvedValue(undefined);
  const onChange = vi.fn();
  const { result, unmount } = renderHook(() =>
    useRealtimeChannel({ name: "org-B", onChange }),
  );

  await act(async () => {});
  expect(result.current.status).toBe("channel_error");
  expect(onChange).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  expect(result.current.status).toBe("subscribed");
  expect(onChange).toHaveBeenCalledTimes(1);
  unmount();
});
