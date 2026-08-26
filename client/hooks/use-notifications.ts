import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type NotificationMetadata = {
  organizationId?: string;
  organizationName?: string;
  role?: string;
  actorName?: string;
  actorEmail?: string;
};

export type NotificationItem = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  organizationId: string | null;
  metadata: NotificationMetadata | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
};

const getNotifications = async () => {
  const res = await api.get<{ data: NotificationsResponse }>("/api/notifications");
  return (res?.data as any)?.data ?? res?.data;
};

const markAsRead = async (id: string) => {
  return await api.patch(`/api/notifications/${id}/read`);
};

const markAllAsRead = async () => {
  return await api.post("/api/notifications/read-all");
};

const deleteNotification = async (id: string) => {
  return await api.delete(`/api/notifications/${id}`);
};

export const useNotifications = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    enabled,
    refetchInterval: enabled ? 15000 : false,
    staleTime: 10000,
  });
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useDeleteNotification = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};
