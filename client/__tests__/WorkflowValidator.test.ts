import { describe, it, expect } from "vitest";
import { validateWorkflowGraph } from "../lib/utils/workflow-validator";

describe("Workflow Validator", () => {
  it("does not report warning when LLM node has promptTemplate", () => {
    const nodes = [
      {
        id: "node-1",
        data: {
          label: "Summarizer",
          type: "LLM_AGENT",
          config: {
            promptTemplate: "Summarize this: {{text}}",
            model: "openai/gpt-oss-120b",
          },
        },
        position: { x: 0, y: 0 },
      },
    ];

    const result = validateWorkflowGraph(nodes as any, []);
    expect(result.isValid).toBe(true);
    expect(result.nodeWarnings.get("node-1") || []).toHaveLength(0);
  });

  it("does not report warning when LLM node has legacy prompt field", () => {
    const nodes = [
      {
        id: "node-1",
        data: {
          label: "Summarizer",
          type: "LLM_AGENT",
          config: {
            prompt: "Summarize this: {{text}}",
            model: "openai/gpt-oss-120b",
          },
        },
        position: { x: 0, y: 0 },
      },
    ];

    const result = validateWorkflowGraph(nodes as any, []);
    expect(result.isValid).toBe(true);
    expect(result.nodeWarnings.get("node-1") || []).toHaveLength(0);
  });

  it("reports warning when LLM node has neither promptTemplate nor prompt", () => {
    const nodes = [
      {
        id: "node-1",
        data: {
          label: "Empty Node",
          type: "LLM_AGENT",
          config: {
            model: "openai/gpt-oss-120b",
          },
        },
        position: { x: 0, y: 0 },
      },
    ];

    const result = validateWorkflowGraph(nodes as any, []);
    expect(result.isValid).toBe(true);
    expect(result.nodeWarnings.get("node-1")).toContain("Prompt template is empty");
  });

  it("detects cyclic graphs and reports blocking error", () => {
    const nodes = [
      { id: "a", data: { label: "A", type: "LLM_AGENT", config: { prompt: "hi", model: "m" } }, position: { x: 0, y: 0 } },
      { id: "b", data: { label: "B", type: "LLM_AGENT", config: { prompt: "hi", model: "m" } }, position: { x: 0, y: 0 } },
    ];
    const edges = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "a" },
    ];

    const result = validateWorkflowGraph(nodes as any, edges as any);
    expect(result.isValid).toBe(false);
    expect(result.blockingErrors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
  });
});
