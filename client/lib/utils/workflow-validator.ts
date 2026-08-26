import { AgentNodeData } from "../types";
import { Edge, Node } from "@xyflow/react";

export type ValidationResult = {
  isValid: boolean;
  blockingErrors: string[];
  nodeWarnings: Map<string, string[]>;
};

export const SUPPORTED_AGENT_TYPES = [
  "LLM_AGENT",
  "HTTP_AGENT",
  "TRANSFORM_AGENT",
] as const;

export function validateWorkflowGraph(
  nodes: Node<AgentNodeData>[],
  edges: Edge[],
): ValidationResult {
  const blockingErrors: string[] = [];
  const nodeWarnings = new Map<string, string[]>();

  const addWarning = (nodeId: string, warning: string) => {
    if (!nodeWarnings.has(nodeId)) {
      nodeWarnings.set(nodeId, []);
    }
    nodeWarnings.get(nodeId)!.push(warning);
  };

  // 1. Not empty check
  if (!nodes || nodes.length === 0) {
    blockingErrors.push("Workflow must contain at least one agent node");
    return { isValid: false, blockingErrors, nodeWarnings };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeLabels = new Map(nodes.map((n) => [n.id, n.data?.label || n.id]));

  // 2. Duplicate node IDs
  if (nodeIds.size !== nodes.length) {
    blockingErrors.push("Workflow contains duplicate node IDs");
  }

  // 3. Node-level configuration warnings
  for (const node of nodes) {
    const data = node.data;
    if (!data) continue;

    if (!data.label || !data.label.trim()) {
      addWarning(node.id, "Node is missing a name");
    }

    if (!SUPPORTED_AGENT_TYPES.includes(data.type as any)) {
      blockingErrors.push(`Unsupported agent type "${data.type}" for node "${data.label}"`);
    }

    const config = (data.config || {}) as Record<string, any>;

    if (data.type === "LLM_AGENT") {
      const promptValue = String(config.promptTemplate ?? config.prompt ?? "");
      if (!promptValue.trim()) {
        addWarning(node.id, "Prompt template is empty");
      }
      if (!config.model) {
        addWarning(node.id, "No LLM model selected");
      }
    } else if (data.type === "HTTP_AGENT") {
      if (!config.url || !config.url.trim()) {
        addWarning(node.id, "HTTP target URL is missing");
      }
    } else if (data.type === "TRANSFORM_AGENT") {
      if (!config.description || !config.description.trim()) {
        addWarning(node.id, "Transformation instruction is empty");
      }
    }
  }

  // 4. Graph Cycle Detection using Kahn's Algorithm
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  const validEdges = edges ? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) : [];

  for (const edge of validEdges) {
    // Detect direct self-loop
    if (edge.source === edge.target) {
      const name = nodeLabels.get(edge.source) || edge.source;
      blockingErrors.push(`Node "${name}" connects to itself, creating a circular loop`);
      continue;
    }

    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Find root nodes (inDegree === 0)
  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  if (queue.length === 0 && nodes.length > 0) {
    blockingErrors.push("Workflow graph has no root node (all nodes have incoming dependencies forming a cycle)");
  } else {
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;

      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        const updatedDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, updatedDeg);
        if (updatedDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (visited !== nodes.length) {
      blockingErrors.push("Workflow contains a circular dependency (cycle) and cannot be executed");
    }
  }

  // 5. Orphaned node warning (multi-node workflows where a node has 0 in-degree and 0 out-degree)
  if (nodes.length > 1) {
    for (const node of nodes) {
      const inDeg = inDegree.get(node.id) ?? 0;
      const outDeg = (adjacency.get(node.id) ?? []).length;
      if (inDeg === 0 && outDeg === 0) {
        addWarning(node.id, "Node is disconnected from the rest of the workflow");
      }
    }
  }

  return {
    isValid: blockingErrors.length === 0,
    blockingErrors,
    nodeWarnings,
  };
}
