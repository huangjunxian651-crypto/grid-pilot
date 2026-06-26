import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { notificationApi, type Notification } from "@/lib/api";
import { useSocket } from "./useSocket";

const NOTI_PREFS_KEY = "gridpilot_noti_prefs";

function loadPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NOTI_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { alert: true, alpha: true, info: true, warn: true };
}

function savePrefs(prefs: Record<string, boolean>) {
  localStorage.setItem(NOTI_PREFS_KEY, JSON.stringify(prefs));
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const { data: rawNotifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: notificationApi.list,
  });

  const [prefs, setPrefs] = useState<Record<string, boolean>>(loadPrefs);
  const { on } = useSocket("notifications");
  const [unreadCount, setUnreadCount] = useState(0);

  // Only derive unreadCount from server-sent events — no optimistic increment,
  // no derivation from the notifications array. This eliminates race conditions.
  useEffect(() => {
    const off = on<number>("unread-count", (count) => {
      setUnreadCount(count);
    });
    return off;
  }, [on]);

  // Apply notification type preferences on the client.
  const notifications = rawNotifications.filter((n) => prefs[n.type] !== false);

  const togglePref = (key: string) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      savePrefs(next);
      return next;
    });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteAll = useMutation({
    mutationFn: () => notificationApi.deleteAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return {
    notifications,
    isLoading,
    unreadCount,
    markRead,
    markAllRead,
    deleteAll,
    prefs,
    togglePref,
  };
}
