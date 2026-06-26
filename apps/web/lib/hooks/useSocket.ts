import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

function getSocketUrl(): string {
  // 1. Explicit override via env
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }

  // 2. Browser: infer from current page location
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    // Use API_PORT from env if available, otherwise default to 5001
    const port = process.env.NEXT_PUBLIC_API_PORT ?? "3301";
    return `${protocol}//${hostname}:${port}`;
  }

  // 3. SSR fallback
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3301";
}

const SOCKET_URL = getSocketUrl();

export function useSocket(namespace = "trading-engine") {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/${namespace}`);
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (socket.connected) {
      queueMicrotask(onConnect);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [namespace]);

  const subscribe = useCallback(
    (sessionCode: string) => {
      socketRef.current?.emit("subscribe", sessionCode);
    },
    []
  );

  const unsubscribe = useCallback(
    (sessionCode: string) => {
      socketRef.current?.emit("unsubscribe", sessionCode);
    },
    []
  );

  const on = useCallback(
    <T = unknown>(event: string, handler: (data: T) => void) => {
      socketRef.current?.on(event, handler as (data: unknown) => void);
      return () => {
        socketRef.current?.off(event, handler as (data: unknown) => void);
      };
    },
    []
  );

  return {
    connected,
    subscribe,
    unsubscribe,
    on,
  };
}
