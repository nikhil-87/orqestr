import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const getAllWorkflows = async () => {
  return await api.get("/api/workflow");
};

const getWorkflowById = async (id: string) => {
  return await api.get(`/api/workflow/${id}`);
};

const createWorkflow = async (data: {
  name: string;
  description?: string;
  definition: unknown;
}) => {
  return await api.post("/api/workflow", { data });
};

const triggerRun = async (id: string, input: Record<string, unknown>) => {
  return await api.post(`/api/workflow/${id}/run`, { data: { input } });
};

const updateWorkflow = async ({
  id,
  data,
}: {
  id: string;
  data: {
    name?: string;
    description?: string;
    definition?: unknown;
  };
}) => {
  return await api.put(`/api/workflow/${id}`, { data });
};

const deleteWorkflow = async (id: string) => {
  return await api.delete(`/api/workflow/${id}`);
};

export const useWorkflows = () => {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: getAllWorkflows,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    retry: 1,
  });
};

export const useWorkflow = (id: string) => {
  return useQuery({
    queryKey: ["workflows", id],
    queryFn: () => getWorkflowById(id),
    enabled: !!id,
  });
};

export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateWorkflow,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["workflows", variables.id] });
    },
  });
};

export const useDeleteWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

export const useTriggerRun = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      triggerRun(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });
};

export type WorkflowVersionItem = {
  id: string;
  workflowId: string;
  version: number;
  name: string;
  description: string | null;
  definition: unknown;
  createdAt: string;
};

const getWorkflowVersions = async (workflowId: string) => {
  return await api.get<{ data: WorkflowVersionItem[] }>(
    `/api/workflow/${workflowId}/versions`,
  );
};

const restoreWorkflowVersion = async ({
  workflowId,
  version,
}: {
  workflowId: string;
  version: number;
}) => {
  return await api.post(`/api/workflow/${workflowId}/versions/${version}/restore`);
};

const duplicateWorkflow = async (workflowId: string) => {
  const original = await api.get<{ data: { name: string; description: string | null; definition: unknown } }>(
    `/api/workflow/${workflowId}`,
  );
  const data = original.data?.data;
  return await api.post("/api/workflow", {
    data: {
      name: `${data.name} (Copy)`,
      description: data.description ?? undefined,
      definition: data.definition,
    },
  });
};

export const useWorkflowVersions = (workflowId: string) => {
  return useQuery({
    queryKey: ["workflows", workflowId, "versions"],
    queryFn: () => getWorkflowVersions(workflowId),
    enabled: !!workflowId,
  });
};

export const useRestoreWorkflowVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: restoreWorkflowVersion,
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["workflows", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows", workflowId, "versions"] });
    },
  });
};

export const useDuplicateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: duplicateWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};
