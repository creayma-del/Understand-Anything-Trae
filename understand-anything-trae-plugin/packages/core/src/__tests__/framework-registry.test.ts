import { describe, it, expect } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import { expressConfig } from "../languages/frameworks/express.js";
import { reactConfig } from "../languages/frameworks/react.js";

describe("FrameworkRegistry", () => {
  it("registers and retrieves a framework config by id", () => {
    const registry = new FrameworkRegistry();
    registry.register(expressConfig);
    expect(registry.getById("express")?.displayName).toBe("Express");
  });

  it("retrieves frameworks for a language", () => {
    const registry = new FrameworkRegistry();
    registry.register(expressConfig);
    registry.register(reactConfig);
    const jsFrameworks = registry.getForLanguage("javascript");
    expect(jsFrameworks).toHaveLength(1);
    expect(jsFrameworks[0].id).toBe("express");
  });

  it("returns empty array for unknown language", () => {
    const registry = new FrameworkRegistry();
    registry.register(expressConfig);
    expect(registry.getForLanguage("haskell")).toEqual([]);
  });

  describe("detectFrameworks", () => {
    it("detects Express from package.json", () => {
      const registry = new FrameworkRegistry();
      registry.register(expressConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"express": "^4.18.0"}}',
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("express");
    });

    it("detects React from package.json", () => {
      const registry = new FrameworkRegistry();
      registry.register(reactConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"}}',
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("react");
    });

    it("detection is case-insensitive", () => {
      const registry = new FrameworkRegistry();
      registry.register(expressConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"Express": "^4.18.0"}}',
      });
      expect(detected).toHaveLength(1);
    });

    it("returns empty array when no frameworks match", () => {
      const registry = new FrameworkRegistry();
      registry.register(expressConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"lodash": "^4.17.0"}}',
      });
      expect(detected).toEqual([]);
    });

    it("returns empty array for empty manifests", () => {
      const registry = new FrameworkRegistry();
      registry.register(expressConfig);
      expect(registry.detectFrameworks({})).toEqual([]);
    });

    it("does not duplicate detected frameworks", () => {
      const registry = new FrameworkRegistry();
      registry.register(reactConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"}}',
      });
      expect(detected).toHaveLength(1);
    });
  });

  it("returns frameworks for all listed languages (cross-language)", () => {
    const registry = FrameworkRegistry.createDefault();
    // React lists both typescript and javascript
    const tsFrameworks = registry.getForLanguage("typescript");
    const jsFrameworks = registry.getForLanguage("javascript");
    expect(tsFrameworks.some((f) => f.id === "react")).toBe(true);
    expect(jsFrameworks.some((f) => f.id === "react")).toBe(true);
  });

  it("does not duplicate on re-registration", () => {
    const registry = new FrameworkRegistry();
    registry.register(expressConfig);
    registry.register(expressConfig);
    expect(registry.getForLanguage("javascript")).toHaveLength(1);
  });

  it("getForLanguage returns a copy, not the internal array", () => {
    const registry = new FrameworkRegistry();
    registry.register(expressConfig);
    const result = registry.getForLanguage("javascript");
    result.push(reactConfig);
    expect(registry.getForLanguage("javascript")).toHaveLength(1);
  });

  describe("createDefault", () => {
    it("registers all 4 built-in framework configs", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getAllFrameworks()).toHaveLength(4);
    });

    it("includes frameworks for multiple languages", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getForLanguage("typescript").length).toBeGreaterThanOrEqual(2);
      expect(registry.getForLanguage("javascript").length).toBeGreaterThanOrEqual(1);
    });
  });
});
