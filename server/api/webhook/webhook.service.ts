import crypto from "crypto";
import { NotFoundError, ValidationError, ConflictError, ApiError } from "../../utils/errors";
import { WebhookRepository } from "./webhook.repository";
import { WorkflowRepository } from "../workflow/workflow.repository";
import { Orchestrator } from "../../orchestrator";

export class WebhookService {
  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly workflowRepository: WorkflowRepository,
    private readonly orchestrator: Orchestrator,
  ) {}

  private async canAccess(
    workflow: { userId: string | null; organizationId: string | null },
    userId: string,
    organizationId?: string,
  ): Promise<boolean> {
    if (workflow.organizationId) {
      if (organizationId && organizationId !== workflow.organizationId) {
        return false;
      }
      const membership = await this.workflowRepository.findOrgMembership(
        workflow.organizationId,
        userId,
      );
      return membership !== null;
    }

    if (organizationId) {
      return false;
    }

    return workflow.userId === userId;
  }

  async getWebhook(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const webhook = await this.webhookRepository.findByWorkflowId(workflowId);
    if (!webhook) throw new NotFoundError("Webhook", workflowId);

    return webhook;
  }

  async createWebhook(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const existing = await this.webhookRepository.findByWorkflowId(workflowId);
    if (existing) {
      throw new ConflictError("A webhook already exists for this workflow");
    }

    const token = crypto.randomBytes(24).toString("hex");

    return await this.webhookRepository.create({
      workflowId,
      userId,
      token,
      enabled: true,
    });
  }

  async toggleWebhook(
    workflowId: string,
    enabled: boolean,
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const current = await this.webhookRepository.findByWorkflowId(workflowId);
    if (!current) throw new NotFoundError("Webhook", workflowId);

    return await this.webhookRepository.update(workflowId, { enabled });
  }

  async regenerateToken(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const current = await this.webhookRepository.findByWorkflowId(workflowId);
    if (!current) throw new NotFoundError("Webhook", workflowId);

    const newToken = crypto.randomBytes(24).toString("hex");

    return await this.webhookRepository.update(workflowId, { token: newToken });
  }

  async deleteWebhook(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const current = await this.webhookRepository.findByWorkflowId(workflowId);
    if (!current) throw new NotFoundError("Webhook", workflowId);

    return await this.webhookRepository.delete(workflowId);
  }

  // ── Public Unauthenticated Inbound Trigger ─────────────────────────────────

  async triggerByToken(token: string, payload: Record<string, unknown>) {
    if (!token) throw new ValidationError("Webhook token is required");

    const webhook = await this.webhookRepository.findByToken(token);
    if (!webhook) {
      throw new NotFoundError("Webhook", token);
    }

    if (!webhook.enabled) {
      throw new ApiError("Webhook is disabled", 403, "WEBHOOK_DISABLED");
    }

    const run = await this.orchestrator.triggerRun(
      webhook.workflowId,
      payload || {},
      webhook.userId,
    );

    await this.webhookRepository.updateLastCalled(token, new Date());

    return run;
  }
}
