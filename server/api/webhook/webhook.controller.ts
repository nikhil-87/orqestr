import { WebhookService } from "./webhook.service";
import { BodyController, BodyParamsController, Controller, ParamsController } from "../../utils/types";

type workflowParams = {
  id: string;
};

type tokenParams = {
  token: string;
};

type toggleWebhookBody = {
  data: {
    enabled: boolean;
  };
};

export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  getWebhook: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const webhook = await this.webhookService.getWebhook(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow webhook fetched successfully",
        success: true,
        data: webhook,
      });
    } catch (err) {
      next(err);
    }
  };

  createWebhook: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const webhook = await this.webhookService.createWebhook(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(201).json({
        message: "Workflow webhook created successfully",
        success: true,
        data: webhook,
      });
    } catch (err) {
      next(err);
    }
  };

  toggleWebhook: BodyParamsController<toggleWebhookBody, workflowParams> = async (
    req,
    res,
    next,
  ) => {
    try {
      const workflowId = req.params.id;
      const { data } = req.body;
      const webhook = await this.webhookService.toggleWebhook(
        workflowId,
        data.enabled,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: `Workflow webhook ${data.enabled ? "enabled" : "disabled"} successfully`,
        success: true,
        data: webhook,
      });
    } catch (err) {
      next(err);
    }
  };

  regenerateToken: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const webhook = await this.webhookService.regenerateToken(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow webhook token regenerated successfully",
        success: true,
        data: webhook,
      });
    } catch (err) {
      next(err);
    }
  };

  deleteWebhook: ParamsController<workflowParams> = async (req, res, next) => {
    try {
      const workflowId = req.params.id;
      const webhook = await this.webhookService.deleteWebhook(
        workflowId,
        req.userId!,
        req.organizationId,
      );
      res.status(200).json({
        message: "Workflow webhook deleted successfully",
        success: true,
        data: webhook,
      });
    } catch (err) {
      next(err);
    }
  };

  // ── Public Unauthenticated Inbound Trigger ─────────────────────────────────

  triggerByToken: Controller = async (req, res, next) => {
    try {
      const token = req.params.token as string;
      const payload = req.body ?? {};
      const run = await this.webhookService.triggerByToken(token, payload);
      res.status(200).json({
        message: "Webhook triggered workflow execution successfully",
        success: true,
        data: run,
      });
    } catch (err) {
      next(err);
    }
  };
}
