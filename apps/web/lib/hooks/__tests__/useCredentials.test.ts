import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { TestProviders } from "../../test-utils";
import {
  useCredentials,
  useCreateCredential,
  useDeleteCredential,
} from "../useCredentials";

describe("useCredentials hooks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useCredentials fetches credentials on mount", async () => {
    const mockCredentials = [
      {
        id: "1",
        exchangeId: "binance",
        accountId: "acc1",
        label: "Main Account",
        isActive: true,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockCredentials),
    } as Response);

    const { result } = renderHook(() => useCredentials(), {
      wrapper: TestProviders,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(mockCredentials);
  });

  it("useCreateCredential creates and returns new credential", async () => {
    const mockCredential = {
      id: "2",
      exchangeId: "binance",
      accountId: "acc2",
      label: "New Account",
      isActive: true,
      createdAt: "2024-01-02T00:00:00Z",
    };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockCredential),
    } as Response);

    const { result } = renderHook(() => useCreateCredential(), {
      wrapper: TestProviders,
    });

    const input = {
      exchangeId: "binance" as const,
      accountId: "acc2",
      label: "New Account",
      apiKey: "key123",
      apiSecret: "secret456",
    };

    const response = await result.current.mutateAsync(input);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(response).toEqual(mockCredential);
  });

  it("useDeleteCredential calls remove API", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve(undefined),
    } as Response);

    const { result } = renderHook(() => useDeleteCredential(), {
      wrapper: TestProviders,
    });

    await result.current.mutateAsync("cred-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
