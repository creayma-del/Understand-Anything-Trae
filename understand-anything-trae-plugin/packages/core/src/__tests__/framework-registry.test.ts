import { describe, it, expect } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import { expressConfig } from "../languages/frameworks/express.js";
import { reactConfig } from "../languages/frameworks/react.js";
import { nuxtConfig } from "../languages/frameworks/nuxt.js";
import { sveltekitConfig } from "../languages/frameworks/sveltekit.js";

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
    expect(jsFrameworks).toHaveLength(2);
    expect(jsFrameworks.map(f => f.id)).toContain("express");
    expect(jsFrameworks.map(f => f.id)).toContain("react");
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
    it("registers all 6 built-in framework configs", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getAllFrameworks()).toHaveLength(6);
    });

    it("includes frameworks for multiple languages", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getForLanguage("typescript").length).toBeGreaterThanOrEqual(2);
      expect(registry.getForLanguage("javascript").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Nuxt framework detection", () => {
  it("detects Nuxt 3 from package.json", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"nuxt": "^3.12.0"}}',
    });
    expect(detected.some(f => f.id === "nuxt")).toBe(true);
  });

  it("detects Nuxt 2 from package.json", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"nuxtjs": "^2.16.0"}}',
    });
    expect(detected.some(f => f.id === "nuxt")).toBe(true);
  });

  it("detects Nuxt from @nuxt/ modules", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"@nuxt/content": "^2.0.0"}}',
    });
    expect(detected.some(f => f.id === "nuxt")).toBe(true);
  });

  it("Nuxt takes priority over Vue when both match", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"nuxt": "^3.12.0", "vue": "^3.4.0"}}',
    });
    const nuxtIndex = detected.findIndex(f => f.id === "nuxt");
    const vueIndex = detected.findIndex(f => f.id === "vue");
    expect(nuxtIndex).toBeLessThan(vueIndex);
  });

  it("does not detect Vue as Nuxt", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"vue": "^3.4.0"}}',
    });
    expect(detected.some(f => f.id === "nuxt")).toBe(false);
    expect(detected.some(f => f.id === "vue")).toBe(true);
  });
});

describe("Nuxt layerHints", () => {
  const config = nuxtConfig;

  it("maps pages to ui", () => {
    expect(config.layerHints?.["pages"]).toBe("ui");
  });

  it("maps server/api to api", () => {
    expect(config.layerHints?.["server/api"]).toBe("api");
  });

  it("maps composables to service", () => {
    expect(config.layerHints?.["composables"]).toBe("service");
  });

  it("maps middleware to middleware", () => {
    expect(config.layerHints?.["middleware"]).toBe("middleware");
  });
});

describe("SvelteKit framework detection", () => {
  it("detects SvelteKit from @sveltejs/kit in package.json", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"devDependencies": {"@sveltejs/kit": "^2.0.0"}}',
    });
    expect(detected.some(f => f.id === "sveltekit")).toBe(true);
  });

  it("detects SvelteKit from @sveltejs/adapter- in package.json", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"devDependencies": {"@sveltejs/adapter-node": "^4.0.0"}}',
    });
    expect(detected.some(f => f.id === "sveltekit")).toBe(true);
  });

  it("detects SvelteKit when both @sveltejs/kit and adapter are present", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"devDependencies": {"@sveltejs/kit": "^2.0.0", "@sveltejs/adapter-static": "^3.0.0"}}',
    });
    expect(detected.filter(f => f.id === "sveltekit")).toHaveLength(1);
  });

  it("does not detect SvelteKit from svelte dependency alone", () => {
    const registry = FrameworkRegistry.createDefault();
    const detected = registry.detectFrameworks({
      "package.json": '{"dependencies": {"svelte": "^5.0.0"}}',
    });
    expect(detected.some(f => f.id === "sveltekit")).toBe(false);
  });
});

describe("SvelteKit layerHints", () => {
  const config = sveltekitConfig;

  it("maps src/routes to ui", () => {
    expect(config.layerHints?.["src/routes"]).toBe("ui");
  });

  it("maps src/lib/components to ui (takes priority over src/lib)", () => {
    expect(config.layerHints?.["src/lib/components"]).toBe("ui");
  });

  it("maps src/lib to service", () => {
    expect(config.layerHints?.["src/lib"]).toBe("service");
  });

  it("maps src/hooks to middleware", () => {
    expect(config.layerHints?.["src/hooks"]).toBe("middleware");
  });
});
