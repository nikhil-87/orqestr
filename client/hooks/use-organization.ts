import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  members?: OrganizationMember[];
};

export type CreateOrgInput = {
  name: string;
  slug?: string;
};

export type AddMemberInput = {
  email: string;
  role?: OrgRole;
};

const getOrganizations = async () => {
  return await api.get<{ data: Organization[] }>("/api/organizations");
};

const getOrganizationById = async (id: string) => {
  return await api.get<{ data: Organization }>(`/api/organizations/${id}`);
};

const createOrganization = async (data: CreateOrgInput) => {
  return await api.post<{ data: Organization }>("/api/organizations", { data });
};

const addMember = async ({
  orgId,
  data,
}: {
  orgId: string;
  data: AddMemberInput;
}) => {
  return await api.post(`/api/organizations/${orgId}/members`, { data });
};

const updateMemberRole = async ({
  orgId,
  userId,
  role,
}: {
  orgId: string;
  userId: string;
  role: OrgRole;
}) => {
  return await api.patch(`/api/organizations/${orgId}/members/${userId}`, {
    data: { role },
  });
};

const removeMember = async ({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) => {
  return await api.delete(`/api/organizations/${orgId}/members/${userId}`);
};

const deleteOrganization = async (orgId: string) => {
  return await api.delete(`/api/organizations/${orgId}`);
};

export const useOrganizations = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: getOrganizations,
    enabled,
  });
};

export const useOrganization = (id?: string | null, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["organization", id],
    queryFn: () => getOrganizationById(id!),
    enabled: enabled && !!id && id !== "personal",
  });
};

export type UpdateOrgInput = {
  name?: string;
  slug?: string;
};

const updateOrganization = async ({
  orgId,
  data,
}: {
  orgId: string;
  data: UpdateOrgInput;
}) => {
  return await api.patch<{ data: Organization }>(`/api/organizations/${orgId}`, { data });
};

export const useCreateOrganization = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createOrganization,
    onSuccess: (res) => {
      const newOrg = (res?.data as any)?.data ?? res?.data;
      if (newOrg && newOrg.id) {
        queryClient.setQueryData(["organizations"], (old: any) => {
          const oldList = (old?.data as any)?.data ?? old?.data ?? [];
          return {
            ...old,
            data: [...oldList, newOrg],
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};

export const useUpdateOrganization = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateOrganization,
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};

export const useAddMember = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addMember,
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};

export const useUpdateMemberRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMemberRole,
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};

export const useRemoveMember = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMember,
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};

export const useDeleteOrganization = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
};
