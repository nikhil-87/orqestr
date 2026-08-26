import { Edge, Node } from "./types";
import { ValidationError } from "./errors";

export function validateNotEmpty(nodes: Node[]): void {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    throw new ValidationError("Workflow must contain at least one node to be executed");
  }
}

export function validateAcyclic(nodes: Node[], edges: Edge[]): void {
  validateNotEmpty(nodes);

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Check for duplicate node IDs
  if (nodeIds.size !== nodes.length) {
    throw new ValidationError("Workflow contains duplicate node IDs");
  }

  // Filter valid edges that connect existing nodes and ignore self-referential / deleted references
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  const validEdges = edges ? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) : [];

  for (const edge of validEdges) {
    // Detect direct self-loop (A -> A)
    if (edge.source === edge.target) {
      throw new ValidationError(`Node "${edge.source}" has a circular self-dependency`);
    }

    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn's Algorithm
  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  if (queue.length === 0) {
    throw new ValidationError("Workflow graph has no root node (all nodes have incoming dependencies, forming a cycle)");
  }

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
    throw new ValidationError("Workflow graph contains a circular dependency (cycle) and cannot be executed");
  }
}

export const SUPPORTED_AGENT_TYPES = [
  "LLM_AGENT",
  "HTTP_AGENT",
  "TRANSFORM_AGENT",
] as const;

export function validateAgentTypes(nodes: Node[]): void {
  for (const node of nodes) {
    if (!node.type || !SUPPORTED_AGENT_TYPES.includes(node.type as any)) {
      throw new ValidationError(
        `Agent type "${node.type}" is not supported by active worker nodes. Supported types: ${SUPPORTED_AGENT_TYPES.join(", ")}`,
      );
    }
  }
}

export function validateWorkflowGraph(nodes: Node[], edges: Edge[]): void {
  validateNotEmpty(nodes);
  validateAgentTypes(nodes);
  validateAcyclic(nodes, edges);
}
