import { PrismaClient, Notification, Prisma } from "@prisma/client";

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    userId: string;
    title: string;
    message: string;
    type?: string;
    organizationId?: string | null;
    metadata?: Prisma.InputJsonValue;
  }): Promise<Notification> {
    return await this.prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || "WORKSPACE_INVITE",
        organizationId: data.organizationId ?? null,
        metadata: data.metadata ?? Prisma.JsonNull,
      },
    });
  }

  async findForUser(userId: string, limit: number = 20): Promise<Notification[]> {
    return await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async findUnreadCount(userId: string): Promise<number> {
    return await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async findById(id: string): Promise<Notification | null> {
    return await this.prisma.notification.findUnique({
      where: { id },
    });
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    return await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string): Promise<Prisma.BatchPayload> {
    return await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async delete(id: string): Promise<Notification> {
    return await this.prisma.notification.delete({
      where: { id },
    });
  }
}
