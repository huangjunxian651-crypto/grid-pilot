import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { TestProviders } from "../../test-utils";
import { useStopRobot, stopAwarePollInterval } from "../useBots";

describe("stopAwarePollInterval", () => {
  it("returns 1500 when robot is STOPPING", () => {
    expect(stopAwarePollInterval("STOPPING")).toBe(1500);
  });
  it("returns 5000 otherwise", () => {
    expect(stopAwarePollInterval("RUNNING")).toBe(5000);
    expect(stopAwarePollInterval(undefined)).toBe(5000);
  });
});

describe("useBots hooks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useStopRobot sends closePosition in request body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, robotId: "r1" }),
    } as Response);

    const { result } = renderHook(() => useStopRobot(), {
      wrapper: TestProviders,
    });

    result.current.mutate({ id: "r1", closePosition: true });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/robots/r1/stop"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ closePosition: true }),
        })
      );
    });
  });

  it("useStopRobot defaults closePosition to false", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, robotId: "r1" }),
    } as Response);

    const { result } = renderHook(() => useStopRobot(), {
      wrapper: TestProviders,
    });

    result.current.mutate({ id: "r1" });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/robots/r1/stop"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ closePosition: false }),
        })
      );
    });
  });
});
