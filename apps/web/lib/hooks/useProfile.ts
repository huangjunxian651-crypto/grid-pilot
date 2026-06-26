import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { profileApi, Profile, UpdateProfileInput } from "@/lib/api";

export function useProfile() {
  return useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: profileApi.get,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<Profile, Error, UpdateProfileInput>({
    mutationFn: profileApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      // Also invalidate auth/me so LanguageSync gets the updated language
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation<{ success: boolean }, Error, void>({
    mutationFn: () => profileApi.delete(),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
      queryClient.setQueryData(["profile"], null);
      router.push("/login");
    },
  });
}
