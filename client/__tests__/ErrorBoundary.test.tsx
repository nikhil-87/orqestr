import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RootErrorBoundary from "@/app/error";

describe("RootErrorBoundary", () => {
  it("renders error heading and description", () => {
    const reset = vi.fn();
    const error = new Error("Network timeout during fetch");

    render(<RootErrorBoundary error={error} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Network timeout during fetch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("calls reset when Try Again button is clicked", () => {
    const reset = vi.fn();
    const error = new Error("Render failure");

    render(<RootErrorBoundary error={error} reset={reset} />);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
