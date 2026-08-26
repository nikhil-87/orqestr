import { Prisma } from "@prisma/client";
import { Orchestrator } from "../../orchestrator";
import { NotFoundError, ValidationError, ApiError } from "../../utils/errors";
import { WorkflowRepository } from "./workflow.repository";
import { cacheService } from "../../cache";
import { CACHE } from "../../config/redis.config";
import { validateWorkflowGraph } from "../../utils/dag-validator";
import { WorkflowDefinition } from "../../utils/types";
import { SchedulerService } from "../scheduler/scheduler.service";

export class WorkflowService {
  constructor(
    private readonly workflowRepository: WorkflowRepository,
    private readonly orchestrator: Orchestrator,
    private readonly schedulerService?: SchedulerService,
  ) {}

  private async canAccess(
    workflow: { userId: string | null; organizationId: string | null; isArchived?: boolean },
    userId: string,
    organizationId?: string,
  ): Promise<boolean> {
    if (workflow.isArchived) {
      return false;
    }

    if (workflow.organizationId) {
      const membership = await this.workflowRepository.findOrgMembership(
        workflow.organizationId,
        userId,
      );
      if (!membership) {
        return false;
      }
      if (organizationId && organizationId !== workflow.organizationId) {
        return false;
      }
      return true;
    }

    if (workflow.userId && workflow.userId === userId) {
      if (organizationId) {
        return false;
      }
      return true;
    }

    return false;
  }

  async getAllWorkflows(userId: string, organizationId?: string) {
    const cacheKey = organizationId
      ? `org:${organizationId}:workflows:all`
      : CACHE.WORKFLOW.ALL.KEY(userId);

    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const workflows = await this.workflowRepository.findAllByUser(userId, organizationId);

    await cacheService.set(cacheKey, workflows, CACHE.WORKFLOW.ALL.TTL);

    return workflows;
  }

  async getWorkflowById(id: string, userId: string, organizationId?: string) {
    if (!id) throw new ValidationError("Workflow ID is required");

    const cacheKey = organizationId
      ? `org:${organizationId}:workflow:${id}`
      : CACHE.WORKFLOW.SINGLE.KEY(userId, id);

    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const workflow = await this.workflowRepository.findById(id);

    if (workflow === null || (workflow as any).isArchived) throw new NotFoundError("Workflow", id);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", id);
    }

    await cacheService.set(cacheKey, workflow, CACHE.WORKFLOW.SINGLE.TTL);

    return workflow;
  }

  async createWorkflow(
    data: {
      name: string;
      description?: string;
      definition: Prisma.InputJsonValue;
      organizationId?: string;
    },
    userId: string,
    organizationId?: string,
  ) {
    const { name, definition } = data;

    if (!name || name.trim() === "") {
      throw new ValidationError("Workflow name is required");
    }

    if (!definition) {
      throw new ValidationError("Workflow definition is required");
    }

    // Validate graph if definition contains nodes and edges
    const def = definition as unknown as WorkflowDefinition;
    if (def && Array.isArray(def.nodes)) {
      validateWorkflowGraph(def.nodes, def.edges || []);
    }

    const effectiveOrgId = organizationId ?? data.organizationId;

    const workflow = await this.workflowRepository.create(
      {
        ...data,
        organizationId: effectiveOrgId,
      },
      userId,
    );

    // Invalidate all workflows list
    if (effectiveOrgId) {
      await cacheService.invalidate(`org:${effectiveOrgId}:workflows:all`);
    } else {
      await cacheService.invalidate(CACHE.WORKFLOW.ALL.KEY(userId));
    }

    // Invalidate dashboard stats
    if (effectiveOrgId) {
      await cacheService.invalidate(`org:${effectiveOrgId}:dashboard:stats`);
    } else {
      await cacheService.invalidate(CACHE.DASHBOARD.STATS.KEY(userId));
    }

    return workflow;
  }

  async updateWorkflow(
    id: string,
    data: {
      name?: string;
      description?: string;
      definition?: Prisma.InputJsonValue;
    },
    userId: string,
    organizationId?: string,
  ) {
    if (!id) throw new ValidationError("Workflow ID is required");

    const current = await this.workflowRepository.findById(id);
    if (!current) throw new NotFoundError("Workflow", id);

    if (!(await this.canAccess(current, userId, organizationId))) {
      throw new NotFoundError("Workflow", id);
    }

    if (data.name !== undefined && (!data.name || data.name.trim() === "")) {
      throw new ValidationError("Name cannot be empty");
    }

    if (data.definition !== undefined) {
      const def = data.definition as unknown as WorkflowDefinition;
      if (def && Array.isArray(def.nodes)) {
        validateWorkflowGraph(def.nodes, def.edges || []);
      }
    }

    // Snapshot current version before overwriting
    await this.workflowRepository.createVersion({
      workflowId: current.id,
      version: current.version,
      name: current.name,
      description: current.description,
      definition: current.definition as any,
    });

    const nextVersion = current.version + 1;

    const updated = await this.workflowRepository.update(id, {
      name: data.name ?? current.name,
      description: data.description !== undefined ? data.description : current.description,
      definition: (data.definition ?? current.definition) as any,
      version: nextVersion,
    });

    // Invalidate caches
    if (current.organizationId) {
      await cacheService.invalidate(`org:${current.organizationId}:workflow:${id}`);
      await cacheService.invalidate(`org:${current.organizationId}:workflows:all`);
    } else {
      await cacheService.invalidate(CACHE.WORKFLOW.SINGLE.KEY(userId, id));
      await cacheService.invalidate(CACHE.WORKFLOW.ALL.KEY(userId));
    }

    return updated;
  }

  async triggerRun(
    workflowId: string,
    input: Record<string, unknown>,
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const run = await this.orchestrator.triggerRun(workflowId, input, userId);

    // Invalidate dashboard — run count and recent runs changed
    if (workflow.organizationId) {
      await cacheService.invalidate(`org:${workflow.organizationId}:dashboard:stats`);
      await cacheService.invalidate(`org:${workflow.organizationId}:dashboard:recent_runs`);
    } else {
      await cacheService.invalidate(CACHE.DASHBOARD.STATS.KEY(userId));
      await cacheService.invalidate(CACHE.DASHBOARD.RECENT_RUNS.KEY(userId));
    }

    return run;
  }

  async deleteWorkflow(id: string, userId: string, organizationId?: string) {
    if (!id) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(id);

    if (workflow === null) throw new NotFoundError("Workflow", id);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", id);
    }

    // RBAC: Only Owners and Admins can delete organization workflows
    if (workflow.organizationId) {
      const membership = await this.workflowRepository.findOrgMembership(
        workflow.organizationId,
        userId,
      );
      if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
        throw new ApiError(
          "Only organization owners and admins can delete workflows",
          403,
          "FORBIDDEN",
        );
      }
    }

    // Clean up associated BullMQ repeatable cron job if present
    if (this.schedulerService) {
      await this.schedulerService.removeRepeatableJob(id);
    }

    const deleted = await this.workflowRepository.delete(id);

    // Invalidate single workflow and list
    if (workflow.organizationId) {
      await cacheService.invalidate(`org:${workflow.organizationId}:workflow:${id}`);
      await cacheService.invalidate(`org:${workflow.organizationId}:workflows:all`);
    } else {
      await cacheService.invalidate(CACHE.WORKFLOW.SINGLE.KEY(userId, id));
      await cacheService.invalidate(CACHE.WORKFLOW.ALL.KEY(userId));
    }

    // Invalidate dashboard — workflow count changed
    if (workflow.organizationId) {
      await cacheService.invalidate(`org:${workflow.organizationId}:dashboard:stats`);
    } else {
      await cacheService.invalidate(CACHE.DASHBOARD.STATS.KEY(userId));
    }

    return deleted;
  }

  // ── Versioning ─────────────────────────────────────────────────────────────

  async getWorkflowVersions(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    return await this.workflowRepository.findVersionsByWorkflowId(workflowId);
  }

  async getWorkflowVersion(
    workflowId: string,
    versionNumber: number,
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");
    if (!versionNumber || isNaN(versionNumber)) {
      throw new ValidationError("Valid version number is required");
    }

    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(workflow, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const version = await this.workflowRepository.findVersion(workflowId, versionNumber);
    if (!version) {
      throw new NotFoundError("WorkflowVersion", `${workflowId} v${versionNumber}`);
    }

    return version;
  }

  async restoreVersion(
    workflowId: string,
    versionNumber: number,
    userId: string,
    organizationId?: string,
  ) {
    if (!workflowId) throw new ValidationError("Workflow ID is required");
    if (!versionNumber || isNaN(versionNumber)) {
      throw new ValidationError("Valid version number is required");
    }

    const current = await this.workflowRepository.findById(workflowId);
    if (!current) throw new NotFoundError("Workflow", workflowId);

    if (!(await this.canAccess(current, userId, organizationId))) {
      throw new NotFoundError("Workflow", workflowId);
    }

    const targetVersion = await this.workflowRepository.findVersion(workflowId, versionNumber);
    if (!targetVersion) {
      throw new NotFoundError("WorkflowVersion", `${workflowId} v${versionNumber}`);
    }

    // Snapshot current active state before rollback
    await this.workflowRepository.createVersion({
      workflowId: current.id,
      version: current.version,
      name: current.name,
      description: current.description,
      definition: current.definition as any,
    });

    const nextVersion = current.version + 1;

    const restored = await this.workflowRepository.update(workflowId, {
      name: targetVersion.name,
      description: targetVersion.description,
      definition: targetVersion.definition as any,
      version: nextVersion,
    });

    // Invalidate caches
    if (current.organizationId) {
      await cacheService.invalidate(`org:${current.organizationId}:workflow:${workflowId}`);
      await cacheService.invalidate(`org:${current.organizationId}:workflows:all`);
    } else {
      await cacheService.invalidate(CACHE.WORKFLOW.SINGLE.KEY(userId, workflowId));
      await cacheService.invalidate(CACHE.WORKFLOW.ALL.KEY(userId));
    }

    return restored;
  }
}
