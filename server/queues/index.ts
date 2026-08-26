import { AgentType } from "@prisma/client";
import { JobsOptions, Queue } from "bullmq";

import { redis } from "../config/redis.config";
import { logger } from "../config/logger.config";

const agentTypes: AgentType[] = [
  AgentType.EXTRACTION_AGENT,
  AgentType.HTTP_AGENT,
  AgentType.LLM_AGENT,
  AgentType.NOTIFICATION_AGENT,
  AgentType.STORAGE_AGENT,
  AgentType.TRANSFORM_AGENT,
];

const queues = new Map<AgentType, Queue>();

for (const type of agentTypes) {
  const queue = new Queue(type, {
    connection: redis,

    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500,

      attempts: 3,

      backoff: {
        type: "exponential",
        delay: 1000,
      },
    },
  });

  queue.on("error", (error) => {
    logger.error(`Queue Error [${type}]: ${error.message}`);
  });

  queue.on("waiting", (jobId) => {
    logger.debug(`Job waiting in ${type}: ${jobId}`);
  });

  queues.set(type, queue);

  logger.info(`BullMQ queue initialized: ${type}`);
}

const addTaskToQueue = async <T>(
  agentType: AgentType,
  jobName: string,
  payload: T,
  options?: JobsOptions,
) => {
  const queue = queues.get(agentType);

  if (!queue) {
    logger.error(`Queue not found for agent type: ${agentType}`);
    throw new Error(`Queue not found for agent type: ${agentType}`);
  }

  const job = await queue.add(jobName, payload, options);

  logger.info(`Job added to ${agentType}. Job ID: ${job.id}`);

  return job;
};

const getQueueByAgentType = (agentType: AgentType): Queue => {
  const queue = queues.get(agentType);

  if (!queue) {
    logger.error(`Queue not found for agent type: ${agentType}`);
    throw new Error(`Queue not found for agent type: ${agentType}`);
  }

  return queue;
};

const closeAllQueues = async () => {
  logger.info("Closing BullMQ queues...");

  await Promise.all(Array.from(queues.values()).map((queue) => queue.close()));

  logger.success("All BullMQ queues closed");
};

export const JobQueue = {
  addTaskToQueue,
  getQueueByAgentType,
  closeAllQueues,
};
