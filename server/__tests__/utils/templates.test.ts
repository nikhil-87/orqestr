import { describe, it, expect } from "vitest";
import { interpolateTemplate } from "../../utils/templates.utils";

describe("interpolateTemplate", () => {
  it("replaces a single placeholder with its value", () => {
    const result = interpolateTemplate("Hello {{name}}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("replaces multiple placeholders", () => {
    const result = interpolateTemplate("{{greeting}}, {{name}}!", {
      greeting: "Hello",
      name: "Alice",
    });
    expect(result).toBe("Hello, Alice!");
  });

  it("replaces an empty string when a key is missing", () => {
    const result = interpolateTemplate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("handles templates with no placeholders", () => {
    const result = interpolateTemplate("Hello World", { name: "Test" });
    expect(result).toBe("Hello World");
  });

  it("trims whitespace inside placeholders", () => {
    const result = interpolateTemplate("Hello {{ name }}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("replaces the same placeholder used multiple times", () => {
    const result = interpolateTemplate("{{x}} + {{x}} = {{y}}", {
      x: "1",
      y: "2",
    });
    expect(result).toBe("1 + 1 = 2");
  });

  it("handles an empty template string", () => {
    const result = interpolateTemplate("", { key: "value" });
    expect(result).toBe("");
  });

  it("resolves nested dot notation properties", () => {
    const result = interpolateTemplate("Hello {{user.name}} from {{user.address.city}}", {
      user: {
        name: "Alice",
        address: { city: "Wonderland" },
      },
    });
    expect(result).toBe("Hello Alice from Wonderland");
  });

  it("falls back to nested properties under data wrapper", () => {
    const result = interpolateTemplate("Comment: {{body}} by {{user.username}}", {
      data: {
        body: "Awesome thinking!",
        user: { username: "emmac" },
      },
      status: 200,
    });
    expect(result).toBe("Comment: Awesome thinking! by emmac");
  });

  it("interpolates entire input with {{input}}", () => {
    const result = interpolateTemplate("Full payload: {{input}}", {
      text: "hello",
    });
    expect(result).toContain('"text": "hello"');
  });
});
