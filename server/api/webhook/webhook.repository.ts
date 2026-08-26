import { PrismaClient, Webhook } from "@prisma/client";
import crypto from "crypto";

export class WebhookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByWorkflowId(workflowId: string): Promise<Webhook | null> {
    return await this.prisma.webhook.findUnique({
      where: { workflowId },
    });
  }

  async findByToken(token: string): Promise<Webhook | null> {
    return await this.prisma.webhook.findUnique({
      where: { token },
    });
  }

  async create(data: {
    workflowId: string;
    userId: string;
    token?: string;
    enabled?: boolean;
  }): Promise<Webhook> {
    const token = data.token ?? crypto.randomBytes(24).toString("hex");
    return await this.prisma.webhook.create({
      data: {
        workflowId: data.workflowId,
        userId: data.userId,
        token,
        enabled: data.enabled ?? true,
      },
    });
  }

  async update(
    workflowId: string,
    data: {
      token?: string;
      enabled?: boolean;
      lastCalledAt?: Date;
    },
  ): Promise<Webhook> {
    return await this.prisma.webhook.update({
      where: { workflowId },
      data,
    });
  }

  async delete(workflowId: string): Promise<Webhook> {
    return await this.prisma.webhook.delete({
      where: { workflowId },
    });
  }

  async updateLastCalled(token: string, lastCalledAt: Date): Promise<void> {
    await this.prisma.webhook.update({
      where: { token },
      data: { lastCalledAt },
    });
  }
}
