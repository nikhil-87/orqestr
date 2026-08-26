import { SchedulerService } from "./scheduler.service";
import { BodyParamsController, ParamsController } from "../../utils/types";

type workflowParams = {
  id: string;
};

type createScheduleBody = {
  data: {
    cronExpression: string;
    timezone?: string;
    input?: Record<string, unknown>;
    enabled?: boolean;
  };
};

type updateScheduleBody = {
  data: {
    cronExpression?: string;
    timezone?: string;
    input?: Record<string, unknown>;
    enabled?: boolean;
  };
};

type toggleScheduleBody = {
  data: {
    enabled: boolean;
  };
};

export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  getSchedule: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const schedule = await this.schedulerService.getSchedule(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow schedule fetched successfully",
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  createSchedule: BodyParamsController<createScheduleBody, workflowParams> = async (
    req,
    res,
    next,
  ) => {
    try {
      const workflowId = req.params.id;
      const { data } = req.body;
      const schedule = await this.schedulerService.createSchedule(
        workflowId,
        data,
        req.userId!,
        req.organizationId,
      );
      res.status(201).json({
        message: "Workflow schedule created successfully",
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  updateSchedule: BodyParamsController<updateScheduleBody, workflowParams> = async (
    req,
    res,
    next,
  ) => {
    try {
      const workflowId = req.params.id;
      const { data } = req.body;
      const schedule = await this.schedulerService.updateSchedule(
        workflowId,
        data,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow schedule updated successfully",
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteSchedule: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const schedule = await this.schedulerService.deleteSchedule(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow schedule deleted successfully",
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };

  toggleSchedule: BodyParamsController<toggleScheduleBody, workflowParams> = async (
    req,
    res,
    next,
  ) => {
    try {
      const workflowId = req.params.id;
      const { data } = req.body;
      const schedule = await this.schedulerService.toggleSchedule(
        workflowId,
        data.enabled,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: `Workflow schedule ${data.enabled ? "enabled" : "disabled"} successfully`,
        success: true,
        data: schedule,
      });
    } catch (err) {
      next(err);
    }
  };
}
