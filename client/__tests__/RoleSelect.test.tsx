import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RoleSelect, { ROLE_DEFINITIONS } from "../components/organization/RoleSelect";

describe("RoleSelect Component", () => {
  it("renders the current active role with label and icon", () => {
    const handleChange = vi.fn();
    render(<RoleSelect value="MEMBER" onChange={handleChange} />);

    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("renders Admin and Owner labels correctly", () => {
    const { rerender } = render(<RoleSelect value="ADMIN" onChange={vi.fn()} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();

    rerender(<RoleSelect value="OWNER" onChange={vi.fn()} />);
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("opens the dropdown menu on click and lists options with role descriptions", async () => {
    const handleChange = vi.fn();
    render(<RoleSelect value="MEMBER" onChange={handleChange} options={["MEMBER", "ADMIN"]} />);

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    // Should display role labels and role badges
    expect(screen.getAllByText("Member").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Admin")).toBeInTheDocument();

    // Should display the role description explaining what each role does
    expect(
      screen.getByText(ROLE_DEFINITIONS.ADMIN.description)
    ).toBeInTheDocument();
    expect(
      screen.getByText(ROLE_DEFINITIONS.MEMBER.description)
    ).toBeInTheDocument();
  });

  it("invokes onChange with the newly selected role", () => {
    const handleChange = vi.fn();
    render(<RoleSelect value="MEMBER" onChange={handleChange} options={["MEMBER", "ADMIN"]} />);

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    const adminOption = screen.getByText(ROLE_DEFINITIONS.ADMIN.description);
    fireEvent.click(adminOption);

    expect(handleChange).toHaveBeenCalledWith("ADMIN");
  });

  it("disables the trigger button when disabled prop is passed", () => {
    render(<RoleSelect value="MEMBER" onChange={vi.fn()} disabled={true} />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
  });

  it("flips upwards when button is positioned near the bottom of viewport", () => {
    // Mock viewport height
    vi.stubGlobal("innerHeight", 768);

    const { container } = render(<RoleSelect value="MEMBER" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button");

    // Mock trigger rect near bottom of screen (bottom = 720px, only 48px space below)
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 690,
      bottom: 720,
      left: 400,
      right: 500,
      width: 100,
      height: 30,
      x: 400,
      y: 690,
      toJSON: () => {},
    });

    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    // In auto-flip mode, top should be positioned ABOVE the trigger (top < 690)
    const topValue = parseInt(listbox.style.top, 10);
    expect(topValue).toBeLessThan(690);
    expect(listbox).toHaveClass("overflow-y-auto");
  });
});

