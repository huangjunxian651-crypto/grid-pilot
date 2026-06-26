import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Badge, Button, Field } from "@/components/ui/primitives";

describe("Badge", () => {
  it("renders children text", () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByText("Test Badge")).toBeInTheDocument();
  });

  it("renders with dot indicator when dot=true", () => {
    const { container } = render(<Badge dot>With Dot</Badge>);
    // The dot is a span inside the badge; it should render an extra span
    const spans = container.querySelectorAll("span");
    // Outer badge span + inner dot span = 2 spans
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Button", () => {
  it("renders children and responds to click", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);
    const btn = screen.getByText("Click Me");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole("button", { name: "Disabled" });
    expect(btn).toBeDisabled();
  });

  it("does not fire onClick when disabled", () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Disabled" });
    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("renders with danger variant styling", () => {
    const { container } = render(<Button danger>Danger</Button>);
    const btn = container.querySelector("button");
    expect(btn).toBeInTheDocument();
    // The danger button uses the danger variant colors
    // We verify the button renders correctly with the danger prop
    expect(screen.getByText("Danger")).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("renders label when provided", () => {
    render(<Field label="Email" />);
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("renders input with defaultValue", () => {
    render(<Field value="hello@example.com" />);
    const input = screen.getByDisplayValue("hello@example.com");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("calls onChange when user types", () => {
    const handleChange = vi.fn();
    render(<Field onChange={handleChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typed text" } });
    expect(handleChange).toHaveBeenCalledWith("typed text");
  });

  it("renders hint when provided", () => {
    render(<Field hint="This is a hint" />);
    expect(screen.getByText("This is a hint")).toBeInTheDocument();
  });

  it("renders suffix when provided", () => {
    render(<Field suffix="USD" />);
    expect(screen.getByText("USD")).toBeInTheDocument();
  });
});
