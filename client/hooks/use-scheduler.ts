import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type WorkflowSchedule = {
  id: string;
  workflowId: string;
  cronExpression: string;
  timezone: string;
  input: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduleInput = {
  cronExpression: string;
  timezone?: string;
  input?: Record<string, unknown>;
  enabled?: boolean;
};

export type UpdateScheduleInput = {
  cronExpression?: string;
  timezone?: string;
  input?: Record<string, unknown>;
  enabled?: boolean;
};

const getSchedule = async (workflowId: string) => {
  try {
    return await api.get<{ data: WorkflowSchedule | null }>(
      `/api/workflow/${workflowId}/schedule`,
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

const createSchedule = async ({
  workflowId,
  data,
}: {
  workflowId: string;
  data: CreateScheduleInput;
}) => {
  return await api.post(`/api/workflow/${workflowId}/schedule`, { data });
};

const updateSchedule = async ({
  workflowId,
  data,
}: {
  workflowId: string;
  data: UpdateScheduleInput;
}) => {
  return await api.put(`/api/workflow/${workflowId}/schedule`, { data });
};

const deleteSchedule = async (workflowId: string) => {
  return await api.delete(`/api/workflow/${workflowId}/schedule`);
};

const toggleSchedule = async ({
  workflowId,
  enabled,
}: {
  workflowId: string;
  enabled: boolean;
}) => {
  return await api.patch(`/api/workflow/${workflowId}/schedule/toggle`, {
    data: { enabled },
  });
};

export const useWorkflowSchedule = (workflowId: string) => {
  return useQuery({
    queryKey: ["schedule", workflowId],
    queryFn: () => getSchedule(workflowId),
    enabled: !!workflowId,
    retry: false,
  });
};

export const useCreateSchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSchedule,
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: ["schedule", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useUpdateSchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSchedule,
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: ["schedule", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useDeleteSchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSchedule,
    onSuccess: (_, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ["schedule", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};

export const useToggleSchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleSchedule,
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: ["schedule", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
  });
};
