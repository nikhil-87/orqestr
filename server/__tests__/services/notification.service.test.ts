import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "../../api/notification/notification.service";
import { NotFoundError, ApiError, ValidationError } from "../../utils/errors";

function createMockNotificationRepository() {
  return {
    create: vi.fn(),
    findForUser: vi.fn(),
    findUnreadCount: vi.fn(),
    findById: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    delete: vi.fn(),
  };
}

describe("NotificationService", () => {
  let repo: ReturnType<typeof createMockNotificationRepository>;
  let service: NotificationService;

  beforeEach(() => {
    repo = createMockNotificationRepository();
    service = new NotificationService(repo as any);
  });

  describe("getUserNotifications", () => {
    it("returns notifications and unread count for user", async () => {
      const notifs = [{ id: "n-1", title: "Test", message: "Msg", isRead: false }];
      repo.findForUser.mockResolvedValue(notifs);
      repo.findUnreadCount.mockResolvedValue(1);

      const result = await service.getUserNotifications("user-1");

      expect(repo.findForUser).toHaveBeenCalledWith("user-1");
      expect(repo.findUnreadCount).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        notifications: notifs,
        unreadCount: 1,
      });
    });

    it("throws ValidationError when userId is empty", async () => {
      await expect(service.getUserNotifications("")).rejects.toThrow(ValidationError);
    });
  });

  describe("markAsRead", () => {
    it("marks notification as read when owned by user", async () => {
      const notif = { id: "n-1", userId: "user-1", isRead: false };
      repo.findById.mockResolvedValue(notif);
      repo.markAsRead.mockResolvedValue({ ...notif, isRead: true });

      const result = await service.markAsRead("n-1", "user-1");

      expect(repo.markAsRead).toHaveBeenCalledWith("n-1", "user-1");
      expect(result.isRead).toBe(true);
    });

    it("throws NotFoundError when notification does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.markAsRead("n-99", "user-1")).rejects.toThrow(NotFoundError);
    });

    it("throws ApiError(403) when user does not own notification", async () => {
      const notif = { id: "n-1", userId: "user-other", isRead: false };
      repo.findById.mockResolvedValue(notif);

      await expect(service.markAsRead("n-1", "user-1")).rejects.toThrow(ApiError);
    });
  });

  describe("deleteNotification", () => {
    it("deletes notification when owned by user", async () => {
      const notif = { id: "n-1", userId: "user-1" };
      repo.findById.mockResolvedValue(notif);
      repo.delete.mockResolvedValue(notif);

      const result = await service.deleteNotification("n-1", "user-1");

      expect(repo.delete).toHaveBeenCalledWith("n-1");
      expect(result).toEqual(notif);
    });

    it("throws ApiError(403) when user tries to delete someone else's notification", async () => {
      const notif = { id: "n-1", userId: "user-victim" };
      repo.findById.mockResolvedValue(notif);

      await expect(service.deleteNotification("n-1", "user-attacker")).rejects.toThrow(ApiError);
    });
  });

  describe("createWorkspaceNotification", () => {
    it("creates an invite notification with actor and role metadata", async () => {
      const payload = {
        userId: "invited-user",
        organizationId: "org-1",
        organizationName: "Acme Engineering",
        role: "MEMBER",
        actorName: "Nikhil",
        actorEmail: "nikhil@orqestr.local",
      };

      const created = { id: "n-1", ...payload, title: "Added to Workspace", isRead: false };
      repo.create.mockResolvedValue(created);

      const result = await service.createWorkspaceNotification(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "invited-user",
          title: "Added to Workspace",
          message: "Nikhil added you to Acme Engineering as MEMBER",
          type: "WORKSPACE_INVITE",
          organizationId: "org-1",
        }),
      );
      expect(result).toEqual(created);
    });

    it("creates a role update notification with appropriate title and message", async () => {
      const payload = {
        userId: "target-user",
        organizationId: "org-1",
        organizationName: "Acme Engineering",
        role: "ADMIN",
        actorName: "Nikhil",
        actorEmail: "nikhil@orqestr.local",
        type: "WORKSPACE_ROLE_CHANGE" as const,
      };

      repo.create.mockResolvedValue({ id: "n-2" });

      await service.createWorkspaceNotification(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Workspace Role Updated",
          message: "Nikhil updated your role in Acme Engineering to ADMIN",
          type: "WORKSPACE_ROLE_CHANGE",
        }),
      );
    });
  });
});
