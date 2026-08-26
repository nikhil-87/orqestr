import { WorkflowService } from "./workflow.service";
import {
  BodyController,
  BodyParamsController,
  Controller,
  ParamsController,
} from "../../utils/types";
import { Prisma } from "@prisma/client";

type params = {
  id: string;
};

type versionParams = {
  id: string;
  version: string;
};

type body = {
  data: {
    name: string;
    description?: string;
    definition: Prisma.InputJsonValue;
    organizationId?: string;
  };
};

type updateBody = {
  data: {
    name?: string;
    description?: string;
    definition?: Prisma.InputJsonValue;
  };
};

type triggerBody = {
  data: { input: Record<string, unknown> };
};

export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  getAllWorkflows: Controller = async (req, res, next) => {
    try {
      const workflows = await this.workflowService.getAllWorkflows(
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflows fetched successfully",
        success: true,
        data: workflows,
      });
    } catch (err) {
      next(err);
    }
  };

  getWorkflowById: ParamsController<params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const workflow = await this.workflowService.getWorkflowById(
        id,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow fetched successfully",
        success: true,
        data: workflow,
      });
    } catch (err) {
      next(err);
    }
  };

  createWorkflow: BodyController<body> = async (req, res, next) => {
    try {
      const { data } = req.body;
      const workflow = await this.workflowService.createWorkflow(
        data,
        req.userId!,
        req.organizationId,
      );
      res.status(201).json({
        message: "Workflow created successfully",
        success: true,
        data: workflow,
      });
    } catch (err) {
      next(err);
    }
  };

  updateWorkflow: BodyParamsController<updateBody, params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const { data } = req.body;
      const workflow = await this.workflowService.updateWorkflow(
        id,
        data,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow updated successfully",
        success: true,
        data: workflow,
      });
    } catch (err) {
      next(err);
    }
  };

  triggerRun: BodyParamsController<triggerBody, params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const { data } = req.body;
      const workflow = await this.workflowService.triggerRun(
        id,
        data.input,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow triggered successfully",
        success: true,
        data: workflow,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteWorkflow: ParamsController<params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const workflow = await this.workflowService.deleteWorkflow(
        id,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow deleted successfully",
        success: true,
        data: workflow,
      });
    } catch (err) {
      next(err);
    }
  };

  // ── Version Handlers ───────────────────────────────────────────────────────

  getWorkflowVersions: ParamsController<params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const versions = await this.workflowService.getWorkflowVersions(
        id,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow versions fetched successfully",
        success: true,
        data: versions,
      });
    } catch (err) {
      next(err);
    }
  };

  getWorkflowVersion: ParamsController<versionParams> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const versionNumber = parseInt(req.params.version, 10);
      const version = await this.workflowService.getWorkflowVersion(
        id,
        versionNumber,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow version fetched successfully",
        success: true,
        data: version,
      });
    } catch (err) {
      next(err);
    }
  };

  restoreWorkflowVersion: ParamsController<versionParams> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const versionNumber = parseInt(req.params.version, 10);
      const restored = await this.workflowService.restoreVersion(
        id,
        versionNumber,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow restored to previous version successfully",
        success: true,
        data: restored,
      });
    } catch (err) {
      next(err);
    }
  };
}
