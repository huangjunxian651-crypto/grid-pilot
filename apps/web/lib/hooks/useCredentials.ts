import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { credentialApi, Credential, CreateCredentialInput, UpdateCredentialInput } from "@/lib/api";

export function useCredentials() {
  return useQuery<Credential[]>({
    queryKey: ["credentials"],
    queryFn: credentialApi.list,
  });
}

export function useCreateCredential() {
  const queryClient = useQueryClient();
  return useMutation<Credential, Error, CreateCredentialInput>({
    mutationFn: credentialApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useUpdateCredential() {
  const queryClient = useQueryClient();
  return useMutation<Credential, Error, { id: string; data: UpdateCredentialInput }>({
    mutationFn: ({ id, data }) => credentialApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: credentialApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
  });
}
