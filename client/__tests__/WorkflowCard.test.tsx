import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "./helpers";
import WorkflowCard from "@/components/workflows/WorkflowCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-workflow", () => ({
  useTriggerRun: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDuplicateWorkflow: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe("WorkflowCard", () => {
  it("renders workflow title, description, node count pill, and action buttons", () => {
    render(
      <WorkflowCard
        id="wf-123"
        name="Customer Support Agent"
        description="Automated support pipeline"
        nodeCount={4}
        createdAt="2026-08-25T10:00:00Z"
      />,
    );

    expect(screen.getByText("Customer Support Agent")).toBeInTheDocument();
    expect(screen.getByText("Automated support pipeline")).toBeInTheDocument();
    expect(screen.getByText("4 nodes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit/i })).toHaveAttribute(
      "href",
      "/workflows/wf-123/edit",
    );
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
  });
});
