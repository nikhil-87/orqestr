import { Controller, ParamsController } from "../../utils/types";
import { AgentService } from "./agent.service";

type params = {
  id: string;
};

export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  getAllAgents: Controller = async (req, res, next) => {
    try {
      const agents = await this.agentService.getAllAgents();
      res.status(200).json({
        message: "Agents fetched successfully",
        success: true,
        data: agents,
      });
    } catch (err) {
      next(err);
    }
  };

  getAgentById: ParamsController<params> = async (req, res, next) => {
    try {
      const id = req.params.id;
      const agent = await this.agentService.getAgentById(id);
      res.status(200).json({
        message: "Agent fetched successfully",
        success: true,
        data: agent,
      });
    } catch (err) {
      next(err);
    }
  };

  testAgent: Controller = async (req, res, next) => {
    try {
      const { type, config, input } = req.body?.data || req.body || {};
      const result = await this.agentService.testAgent(type, config, input);
      res.status(200).json({
        message: result.success ? "Agent tested successfully" : "Agent test execution failed",
        success: result.success,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}
