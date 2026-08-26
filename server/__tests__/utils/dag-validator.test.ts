import { describe, it, expect } from "vitest";
import {
  validateWorkflowGraph,
  validateNotEmpty,
  validateAcyclic,
} from "../../utils/dag-validator";
import { ValidationError } from "../../utils/errors";
import { AgentType } from "@prisma/client";
import { Node, Edge } from "../../utils/types";

const makeNode = (id: string, name: string): Node => ({
  id,
  name,
  type: AgentType.LLM_AGENT,
  critical: true,
  config: { promptTemplate: "test", model: "test", maxTokens: 100 },
});

describe("DAG Validator", () => {
  describe("validateNotEmpty", () => {
    it("throws ValidationError for empty nodes array", () => {
      expect(() => validateNotEmpty([])).toThrow(ValidationError);
    });
  });

  describe("validateAcyclic", () => {
    it("passes for a valid single-node graph", () => {
      const nodes = [makeNode("node-1", "Single Step")];
      const edges: Edge[] = [];
      expect(() => validateAcyclic(nodes, edges)).not.toThrow();
    });

    it("passes for a valid linear chain A -> B -> C", () => {
      const nodes = [
        makeNode("node-a", "Step A"),
        makeNode("node-b", "Step B"),
        makeNode("node-c", "Step C"),
      ];
      const edges: Edge[] = [
        { id: "e1", source: "node-a", target: "node-b" },
        { id: "e2", source: "node-b", target: "node-c" },
      ];
      expect(() => validateAcyclic(nodes, edges)).not.toThrow();
    });

    it("passes for a diamond fan-in/fan-out graph (A -> B, A -> C, B -> D, C -> D)", () => {
      const nodes = [
        makeNode("A", "A"),
        makeNode("B", "B"),
        makeNode("C", "C"),
        makeNode("D", "D"),
      ];
      const edges: Edge[] = [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "A", target: "C" },
        { id: "e3", source: "B", target: "D" },
        { id: "e4", source: "C", target: "D" },
      ];
      expect(() => validateWorkflowGraph(nodes, edges)).not.toThrow();
    });

    it("rejects direct self-loop A -> A", () => {
      const nodes = [makeNode("A", "Self Node")];
      const edges: Edge[] = [{ id: "e1", source: "A", target: "A" }];
      expect(() => validateAcyclic(nodes, edges)).toThrow(ValidationError);
    });

    it("rejects 2-node cycle A -> B -> A", () => {
      const nodes = [makeNode("A", "Node A"), makeNode("B", "Node B")];
      const edges: Edge[] = [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "B", target: "A" },
      ];
      expect(() => validateAcyclic(nodes, edges)).toThrow(ValidationError);
    });

    it("rejects 3-node cycle A -> B -> C -> A", () => {
      const nodes = [
        makeNode("A", "Node A"),
        makeNode("B", "Node B"),
        makeNode("C", "Node C"),
      ];
      const edges: Edge[] = [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "B", target: "C" },
        { id: "e3", source: "C", target: "A" },
      ];
      expect(() => validateAcyclic(nodes, edges)).toThrow(ValidationError);
    });

    it("rejects duplicate node IDs", () => {
      const nodes = [makeNode("A", "Node A1"), makeNode("A", "Node A2")];
      expect(() => validateAcyclic(nodes, [])).toThrow("duplicate node IDs");
    });
  });

  describe("validateAgentTypes", () => {
    it("accepts valid active agent types (LLM_AGENT, HTTP_AGENT, TRANSFORM_AGENT)", () => {
      const nodes: Node[] = [
        { id: "1", name: "LLM", type: AgentType.LLM_AGENT, critical: true, config: { promptTemplate: "test", model: "test", maxTokens: 100 } },
        { id: "2", name: "HTTP", type: AgentType.HTTP_AGENT, critical: true, config: { promptTemplate: "test", model: "test", maxTokens: 100 } },
        { id: "3", name: "Transform", type: AgentType.TRANSFORM_AGENT, critical: true, config: { promptTemplate: "test", model: "test", maxTokens: 100 } },
      ];
      expect(() => validateWorkflowGraph(nodes, [])).not.toThrow();
    });

    it("rejects uninstantiated agent types (EXTRACTION_AGENT, NOTIFICATION_AGENT, STORAGE_AGENT)", () => {
      const nodes: Node[] = [
        { id: "1", name: "Extraction", type: "EXTRACTION_AGENT" as any, critical: true, config: { promptTemplate: "test", model: "test", maxTokens: 100 } },
      ];
      expect(() => validateWorkflowGraph(nodes, [])).toThrow(/not supported by active worker nodes/i);
    });
  });
});
