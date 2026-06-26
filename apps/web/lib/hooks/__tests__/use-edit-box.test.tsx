import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useEditBox } from "../useBots";
import * as api from "../../api";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useEditBox", () => {
  it("调用 robotApi.editBox", async () => {
    const spy = vi.spyOn(api.robotApi, "editBox").mockResolvedValue({ success: true });
    const { result } = renderHook(() => useEditBox("r1"), { wrapper: wrap() });
    const input = { takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 0, stopLossGridStep: 2 };
    await act(async () => { result.current.mutate({ configId: "b1", input }); });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("r1", "b1", input));
  });
});
