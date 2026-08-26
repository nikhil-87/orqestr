import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type WorkflowWebhook = {
  id: string;
  workflowId: string;
  token: string;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const getWebhook = async (workflowId: string) => {
  try {
    return await api.get<{ data: WorkflowWebhook | null }>(
      `/api/workflow/${workflowId}/webhook`,
    );
  } catch (err: any) {
    if (
      err?.response?.status === 404 ||
      (typeof err?.message === "string" && err.message.toLowerCase().includes("not found"))
    ) {
      return { data: null };
    }
    throw err;
  }
};

const createWebhook = async (workflowId: string) => {
  return await api.post(`/api/workflow/${workflowId}/webhook`);
};

const toggleWebhook = async ({
  workflowId,
  enabled,
}: {
  workflowId: string;
  enabled: boolean;
}) => {
  return await api.patch(`/api/workflow/${workflowId}/webhook/toggle`, {
    data: { enabled },
  });
};

const regenerateWebhookToken = async (workflowId: string) => {
  return await api.post(`/api/workflow/${workflowId}/webhook/regenerate`);
};

const deleteWebhook = async (workflowId: string) => {
  return await api.delete(`/api/workflow/${workflowId}/webhook`);
};

export const useWorkflowWebhook = (workflowId: string) => {
  return useQuery({
    queryKey: ["webhook", workflowId],
    queryFn: () => getWebhook(workflowId),
    enabled: !!workflowId,
    retry: false,
  });
};

export const useCreateWebhook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWebhook,
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ["webhook", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useToggleWebhook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleWebhook,
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: ["webhook", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useRegenerateWebhookToken = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: regenerateWebhookToken,
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ["webhook", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useDeleteWebhook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWebhook,
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ["webhook", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};
