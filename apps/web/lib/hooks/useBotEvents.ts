import { useEffect, useState, useCallback } from "react";
import { useSocket } from "./useSocket";
import { useAccountStore } from "@/lib/store";
import type { AccountSnapshot, BotStatus } from "@/lib/api";

interface TickerData {
  sessionCode?: string;
  price?: number;
  bestBid?: number;
  bestAsk?: number;
}

interface FsmData {
  sessionCode?: string;
  from?: string;
  to?: string;
  reason?: string;
}

interface FillData {
  sessionCode?: string;
  id?: string;
  orderId?: string;
  side?: "buy" | "sell";
  price?: number;
  qty?: number;
  gridIndex?: number;
  route?: "POC" | "GTC";
  fee?: number;
  ts?: number;
  // runner 广播的 FillPayload 已含这些字段，透传供实时成交行直接展示。
  avgGridPrice?: number;
  savings?: number;
  savingsRate?: number;
}

interface OrderPlacedData {
  sessionCode?: string;
  gridIndex?: number;
  side?: "buy" | "sell";
  price?: number;
  qty?: number;
  orderId?: string;
}

interface OrderCancelledData {
  sessionCode?: string;
  gridIndex?: number;
  orderId?: string;
}

export interface BotEventState {
  price: number;
  fsm: string;
  fills: FillData[];
  lastFill: FillData | null;
  orderPlaced: OrderPlacedData | null;
  orderCancelled: OrderCancelledData | null;
  liveStatus: BotStatus | null;
}

const INITIAL_STATE: BotEventState = {
  price: 0,
  fsm: "",
  fills: [],
  lastFill: null,
  orderPlaced: null,
  orderCancelled: null,
  liveStatus: null,
};

export function useBotEvents(sessionCode: string | null) {
  const { connected, subscribe, unsubscribe, on } = useSocket();

  const [state, setState] = useState<BotEventState>(INITIAL_STATE);

  const updateFills = useCallback((data: FillData) => {
    setState((prev) => ({
      ...prev,
      fills: [data, ...prev.fills].slice(0, 200),
      lastFill: data,
    }));
  }, []);

  useEffect(() => {
    // Reset event state when session changes to avoid stale data from previous session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(INITIAL_STATE);
    if (!sessionCode || !connected) return;
    subscribe(sessionCode);
    return () => {
      unsubscribe(sessionCode);
    };
  }, [sessionCode, connected, subscribe, unsubscribe]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(
      on<TickerData>("ticker", (data) => {
        if (data?.sessionCode === sessionCode) {
          setState((prev) => ({ ...prev, price: data.price ?? 0 }));
        }
      })
    );

    cleanups.push(
      on<FsmData>("fsm", (data) => {
        if (data?.sessionCode === sessionCode) {
          setState((prev) => ({ ...prev, fsm: data.to ?? "" }));
        }
      })
    );

    cleanups.push(
      on<FillData>("fill", (data) => {
        if (data?.sessionCode === sessionCode) {
          updateFills(data);
        }
      })
    );

    cleanups.push(
      on<OrderPlacedData>("orderPlaced", (data) => {
        if (data?.sessionCode === sessionCode) {
          setState((prev) => ({ ...prev, orderPlaced: data }));
        }
      })
    );

    cleanups.push(
      on<OrderCancelledData>("orderCancelled", (data) => {
        if (data?.sessionCode === sessionCode) {
          setState((prev) => ({ ...prev, orderCancelled: data }));
        }
      })
    );

    cleanups.push(
      on<AccountSnapshot>("account", (data) => {
        useAccountStore.getState().updateSnapshot(data);
      })
    );

    cleanups.push(
      on<BotStatus>("status", (data) => {
        if (data?.sessionCode === sessionCode) {
          setState((prev) => ({ ...prev, liveStatus: data }));
        }
      })
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [sessionCode, on, updateFills]);

  return {
    connected,
    ...state,
  };
}
