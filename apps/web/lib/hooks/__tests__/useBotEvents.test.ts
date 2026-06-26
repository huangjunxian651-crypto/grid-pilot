import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBotEvents } from "../useBotEvents";

vi.mock("socket.io-client", () => ({
  io: vi.fn(),
}));

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
};

import { io } from "socket.io-client";

function simulateConnect() {
  const handler = mockSocket.on.mock.calls.find(
    (c) => c[0] === "connect"
  )?.[1];
  if (handler) act(() => handler());
}

function getHandler(event: string): ((data: unknown) => void) | undefined {
  const call = mockSocket.on.mock.calls.find((c) => c[0] === event);
  return call?.[1];
}

describe("useBotEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    vi.mocked(io).mockReturnValue(mockSocket as unknown as ReturnType<typeof io>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not subscribe when sessionCode is null", () => {
    renderHook(() => useBotEvents(null));
    simulateConnect();
    expect(mockSocket.emit).not.toHaveBeenCalledWith("subscribe", expect.anything());
  });

  it("subscribes with the given sessionCode after connected", () => {
    renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    expect(mockSocket.emit).toHaveBeenCalledWith("subscribe", "SESSION-ABC");
  });

  it("unsubscribes previous sessionCode on re-subscription", async () => {
    const { rerender } = renderHook(
      ({ sc }: { sc: string }) => useBotEvents(sc),
      { initialProps: { sc: "SESSION-ABC" } },
    );
    simulateConnect();

    await waitFor(() => {
      expect(mockSocket.emit).toHaveBeenCalledWith("subscribe", "SESSION-ABC");
    });

    rerender({ sc: "SESSION-XYZ" });

    expect(mockSocket.emit).toHaveBeenCalledWith("unsubscribe", "SESSION-ABC");
    expect(mockSocket.emit).toHaveBeenCalledWith("subscribe", "SESSION-XYZ");
  });

  it("resets all state when sessionCode changes", async () => {
    const { result, rerender } = renderHook(
      ({ sc }: { sc: string }) => useBotEvents(sc),
      { initialProps: { sc: "SESSION-ABC" } },
    );
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("ticker")).toBeDefined();
    });

    act(() => {
      getHandler("ticker")!({ sessionCode: "SESSION-ABC", price: 2009.1 });
      getHandler("fsm")!({ sessionCode: "SESSION-ABC", to: "RUNNING" });
      getHandler("fill")!({ sessionCode: "SESSION-ABC", id: "f1" });
      getHandler("orderPlaced")!({ sessionCode: "SESSION-ABC", gridIndex: 1 });
      getHandler("orderCancelled")!({ sessionCode: "SESSION-ABC", orderId: "o1" });
    });

    expect(result.current.price).toBe(2009.1);
    expect(result.current.fsm).toBe("RUNNING");
    expect(result.current.fills).toHaveLength(1);
    expect(result.current.orderPlaced).toBeDefined();
    expect(result.current.orderCancelled).toBeDefined();

    rerender({ sc: "SESSION-XYZ" });

    expect(result.current.price).toBe(0);
    expect(result.current.fsm).toBe("");
    expect(result.current.fills).toHaveLength(0);
    expect(result.current.lastFill).toBeNull();
    expect(result.current.orderPlaced).toBeNull();
    expect(result.current.orderCancelled).toBeNull();
  });

  it("updates price on matching ticker event", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("ticker")).toBeDefined();
    });

    act(() => {
      getHandler("ticker")!({ sessionCode: "SESSION-ABC", price: 2009.1 });
    });

    expect(result.current.price).toBe(2009.1);
  });

  it("ignores ticker events for other sessionCodes", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("ticker")).toBeDefined();
    });

    act(() => {
      getHandler("ticker")!({ sessionCode: "SESSION-XYZ", price: 9999 });
    });

    expect(result.current.price).toBe(0);
  });

  it("updates fsm on matching fsm event", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("fsm")).toBeDefined();
    });

    act(() => {
      getHandler("fsm")!({ sessionCode: "SESSION-ABC", to: "RUNNING" });
    });

    expect(result.current.fsm).toBe("RUNNING");
  });

  it("appends fills on matching fill event", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("fill")).toBeDefined();
    });

    act(() => {
      getHandler("fill")!({
        sessionCode: "SESSION-ABC",
        id: "fill-1",
        side: "buy",
        price: 2000,
        qty: 0.1,
      });
    });

    expect(result.current.fills).toHaveLength(1);
    expect(result.current.fills[0].id).toBe("fill-1");
    expect(result.current.lastFill?.id).toBe("fill-1");
  });

  it("updates orderPlaced on matching event", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("orderPlaced")).toBeDefined();
    });

    act(() => {
      getHandler("orderPlaced")!({ sessionCode: "SESSION-ABC", gridIndex: 3, side: "buy" });
    });

    expect(result.current.orderPlaced).toEqual({
      sessionCode: "SESSION-ABC",
      gridIndex: 3,
      side: "buy",
    });
  });

  it("updates orderCancelled on matching event", async () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    simulateConnect();

    await waitFor(() => {
      expect(getHandler("orderCancelled")).toBeDefined();
    });

    act(() => {
      getHandler("orderCancelled")!({ sessionCode: "SESSION-ABC", orderId: "ord-1" });
    });

    expect(result.current.orderCancelled).toEqual({
      sessionCode: "SESSION-ABC",
      orderId: "ord-1",
    });
  });

  it("exposes connected state from useSocket", () => {
    const { result } = renderHook(() => useBotEvents("SESSION-ABC"));
    expect(result.current.connected).toBe(false);

    simulateConnect();

    expect(result.current.connected).toBe(true);
  });
});
