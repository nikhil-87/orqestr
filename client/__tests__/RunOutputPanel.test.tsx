import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "./helpers";
import RunOutputPanel from "../components/monitor/RunOutputPanel";

describe("RunOutputPanel Component", () => {
  it("renders nothing when status is RUNNING or PENDING", () => {
    const { container } = render(
      <RunOutputPanel
        status="RUNNING"
        output={null}
        error={null}
        duration={12}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders completion header and output when COMPLETED", () => {
    render(
      <RunOutputPanel
        status="COMPLETED"
        output={{ text: "Workflow output successfully computed" }}
        error={null}
        duration={4.5}
      />,
    );

    expect(screen.getByText(/Execution completed/i)).toBeDefined();
    expect(screen.getByText(/4.5s/i)).toBeDefined();
  });

  it("renders error state when FAILED", () => {
    render(
      <RunOutputPanel
        status="FAILED"
        output={null}
        error="Connection timeout during HTTP fetch"
        duration={8.2}
      />,
    );

    expect(screen.getByText(/Execution failed/i)).toBeDefined();
    expect(screen.getByText(/8.2s/i)).toBeDefined();
  });

  it("renders cancellation state with amber styling when CANCELLED", () => {
    render(
      <RunOutputPanel
        status="CANCELLED"
        output={null}
        error="Workflow run was cancelled by the user."
        duration={2.1}
      />,
    );

    expect(screen.getByText(/Execution cancelled/i)).toBeDefined();
    expect(screen.getByText(/2.1s/i)).toBeDefined();
  });
});
