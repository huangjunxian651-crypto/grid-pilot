import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, AuthUser } from "@/lib/api";

export function useAuth() {
  return useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (e: unknown) {
        // 401 = "not authenticated" — a valid state, not a query error.
        // Return null so the caller sees the user as logged-out.
        if ((e as Error & { status?: number })?.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
    // Prevent the global QueryCache 401 handler from redirecting to /login.
    meta: { skipAuthRedirect: true },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<{ user: AuthUser }, Error, { email: string; password: string }>({
    mutationFn: authApi.login,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation<{ user: AuthUser }, Error, { email: string; password: string; language?: string }>({
    mutationFn: authApi.register,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation<void, Error>({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
      // Hard redirect to clear all client state (queries, closures, etc.)
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, { currentPassword: string; newPassword: string }>({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
