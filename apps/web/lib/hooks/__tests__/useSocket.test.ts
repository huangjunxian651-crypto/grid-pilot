import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSocket } from "../useSocket";

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

describe("useSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    vi.mocked(io).mockReturnValue(mockSocket as unknown as ReturnType<typeof io>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to namespace on mount (verify io called with URL containing namespace)", () => {
    renderHook(() => useSocket("trading-engine"));
    expect(io).toHaveBeenCalledTimes(1);
    expect(vi.mocked(io).mock.calls[0][0]).toContain("/trading-engine");
  });

  it("sets connected true on connect event", () => {
    const { result } = renderHook(() => useSocket("trading-engine"));

    const connectHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === "connect"
    )?.[1];

    expect(connectHandler).toBeDefined();

    act(() => {
      connectHandler!();
    });

    expect(result.current.connected).toBe(true);
  });

  it("sets connected false on disconnect event", () => {
    const { result } = renderHook(() => useSocket("trading-engine"));

    const connectHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === "connect"
    )?.[1];
    const disconnectHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === "disconnect"
    )?.[1];

    act(() => {
      connectHandler!();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      disconnectHandler!();
    });
    expect(result.current.connected).toBe(false);
  });

  it("subscribe emits 'subscribe' with sessionCode", () => {
    const { result } = renderHook(() => useSocket("trading-engine"));

    act(() => {
      result.current.subscribe("SESSION123");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("subscribe", "SESSION123");
  });

  it("unsubscribe emits 'unsubscribe' with sessionCode", () => {
    const { result } = renderHook(() => useSocket("trading-engine"));

    act(() => {
      result.current.unsubscribe("SESSION123");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("unsubscribe", "SESSION123");
  });

  it("on registers event handler", () => {
    const { result } = renderHook(() => useSocket("trading-engine"));

    const handler = vi.fn();

    act(() => {
      result.current.on("price_update", handler);
    });

    expect(mockSocket.on).toHaveBeenCalledWith("price_update", handler);
  });

  it("disconnects socket on unmount", () => {
    const { unmount } = renderHook(() => useSocket("trading-engine"));

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith("disconnect", expect.any(Function));
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });
});
