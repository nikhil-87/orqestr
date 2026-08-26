import { NotificationRepository } from "./notification.repository";
import { NotFoundError, ApiError, ValidationError } from "../../utils/errors";

export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async getUserNotifications(userId: string) {
    if (!userId) throw new ValidationError("User ID is required");
    const notifications = await this.notificationRepository.findForUser(userId);
    const unreadCount = await this.notificationRepository.findUnreadCount(userId);
    return {
      notifications,
      unreadCount,
    };
  }

  async markAsRead(id: string, userId: string) {
    if (!id) throw new ValidationError("Notification ID is required");
    const notification = await this.notificationRepository.findById(id);
    if (!notification) {
      throw new NotFoundError("Notification", id);
    }
    if (notification.userId !== userId) {
      throw new ApiError("You do not have permission to access this notification", 403, "FORBIDDEN");
    }
    return await this.notificationRepository.markAsRead(id, userId);
  }

  async markAllAsRead(userId: string) {
    if (!userId) throw new ValidationError("User ID is required");
    return await this.notificationRepository.markAllAsRead(userId);
  }

  async deleteNotification(id: string, userId: string) {
    if (!id) throw new ValidationError("Notification ID is required");
    const notification = await this.notificationRepository.findById(id);
    if (!notification) {
      throw new NotFoundError("Notification", id);
    }
    if (notification.userId !== userId) {
      throw new ApiError("You do not have permission to delete this notification", 403, "FORBIDDEN");
    }
    return await this.notificationRepository.delete(id);
  }

  async createWorkspaceNotification(data: {
    userId: string;
    organizationId: string;
    organizationName: string;
    role: string;
    actorName: string;
    actorEmail: string;
    type?: "WORKSPACE_INVITE" | "WORKSPACE_ROLE_CHANGE";
  }) {
    const isRoleChange = data.type === "WORKSPACE_ROLE_CHANGE";
    const title = isRoleChange ? "Workspace Role Updated" : "Added to Workspace";
    const message = isRoleChange
      ? `${data.actorName} updated your role in ${data.organizationName} to ${data.role}`
      : `${data.actorName} added you to ${data.organizationName} as ${data.role}`;

    return await this.notificationRepository.create({
      userId: data.userId,
      title,
      message,
      type: data.type || "WORKSPACE_INVITE",
      organizationId: data.organizationId,
      metadata: {
        organizationId: data.organizationId,
        organizationName: data.organizationName,
        role: data.role,
        actorName: data.actorName,
        actorEmail: data.actorEmail,
      },
    });
  }
}
