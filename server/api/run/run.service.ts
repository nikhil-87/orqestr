import { NotFoundError, ValidationError } from "../../utils/errors";
import { WorkflowRunRepository } from "./run.repository";
import { runEmitter } from "../../events/run.emitter";

export class WorkflowRunService {
  constructor(private readonly workflowRunRepository: WorkflowRunRepository) {}

  private async canAccess(
    run: {
      userId: string | null;
      workflow?: { userId: string | null; organizationId: string | null } | null;
    },
    userId: string,
    organizationId?: string,
  ): Promise<boolean> {
    if (run.workflow?.organizationId) {
      if (organizationId && organizationId !== run.workflow.organizationId) {
        return false;
      }
      const membership = await this.workflowRunRepository.findOrgMembership(
        run.workflow.organizationId,
        userId,
      );
      return membership !== null;
    }

    if (organizationId) {
      return false;
    }

    return run.userId === userId || run.workflow?.userId === userId;
  }

  async getAllRuns(userId: string, organizationId?: string) {
    return await this.workflowRunRepository.findAllByUser(userId, organizationId);
  }

  async getRunById(id: string, userId: string, organizationId?: string) {
    if (!id) {
      throw new ValidationError("Workflow run ID is required");
    }

    const workflowRun = await this.workflowRunRepository.findById(id);
    if (workflowRun === null) {
      throw new NotFoundError("Workflow run", id);
    }

    if (!(await this.canAccess(workflowRun, userId, organizationId))) {
      throw new NotFoundError("Workflow run", id);
    }

    return workflowRun;
  }

  async getRunsByWorkflowId(workflowId: string, userId: string, organizationId?: string) {
    if (!workflowId) {
      throw new ValidationError("Workflow ID is required");
    }

    const runs = await this.workflowRunRepository.findByWorkflowId(workflowId);

    // Filter runs accessible to this user/org context
    const accessibleRuns = [];
    for (const run of runs) {
      if (await this.canAccess(run, userId, organizationId)) {
        accessibleRuns.push(run);
      }
    }
    return accessibleRuns;
  }

  async cancelRun(id: string, userId: string, organizationId?: string) {
    if (!id) {
      throw new ValidationError("Workflow run ID is required");
    }

    const run = await this.workflowRunRepository.findById(id);
    if (run === null) {
      throw new NotFoundError("Workflow run", id);
    }

    if (!(await this.canAccess(run, userId, organizationId))) {
      throw new NotFoundError("Workflow run", id);
    }

    if (run.status !== "PENDING" && run.status !== "RUNNING") {
      throw new ValidationError(`Cannot cancel a workflow run with status "${run.status}"`);
    }

    const cancelledRun = await this.workflowRunRepository.cancelRun(id);

    // Notify all active SSE listeners
    runEmitter.emit(`run:${id}`, {
      type: "RUN_CANCELLED",
      runId: id,
      status: "CANCELLED",
      error: "Workflow run cancelled by user",
    });

    return cancelledRun;
  }
}
