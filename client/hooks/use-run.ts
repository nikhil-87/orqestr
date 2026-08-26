import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const getAllRuns = async () => {
  return await api.get("/api/runs");
};

const getRunById = async (id: string) => {
  return await api.get(`/api/runs/${id}`);
};

const getRunsByWorkflowId = async (id: string) => {
  return await api.get(`/api/runs/workflow/${id}`);
};

const cancelRun = async (id: string) => {
  return await api.post(`/api/runs/${id}/cancel`);
};

export const useRuns = () => {
  return useQuery({
    queryKey: ["runs"],
    queryFn: getAllRuns,
  });
};

export const useRun = (id: string) => {
  return useQuery({
    queryKey: ["runs", id],
    queryFn: () => getRunById(id),
    enabled: !!id,
  });
};

export const useWorkflowRuns = (id: string) => {
  return useQuery({
    queryKey: ["runs", "workflow", id],
    queryFn: () => getRunsByWorkflowId(id),
    enabled: !!id,
  });
};

export const useCancelRun = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelRun,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["runs", id] });
    },
  });
};
