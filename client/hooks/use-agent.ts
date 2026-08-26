import { api } from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";

const getAllAgents = async () => {
  return await api.get("/api/agents");
};

const getAgentById = async (id: string) => {
  return await api.get(`/api/agents/${id}`);
};

export type TestAgentPayload = {
  type: string;
  config: Record<string, unknown>;
  input?: Record<string, unknown>;
};

export type TestAgentResponse = {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
};

const testAgent = async (data: TestAgentPayload) => {
  return await api.post<{ data: TestAgentResponse }>("/api/agents/test", { data });
};

export const useAgents = () => {
  return useQuery({
    queryKey: ["agents"],
    queryFn: getAllAgents,
  });
};

export const useAgent = (id: string) => {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => getAgentById(id),
    enabled: !!id,
  });
};

export const useTestAgent = () => {
  return useMutation({
    mutationFn: testAgent,
  });
};
