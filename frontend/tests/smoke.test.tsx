import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

function SmokeComponent() {
  return <h1>Taskweb Test Harness</h1>;
}

describe("smoke", () => {
  it("renders test harness", () => {
    render(<SmokeComponent />);
    expect(screen.getByRole("heading", { name: "Taskweb Test Harness" })).toBeTruthy();
  });
});
