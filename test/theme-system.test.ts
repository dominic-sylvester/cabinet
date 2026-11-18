import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyTheme, DEFAULT_THEME_PAIR, findThemeByName, getStoredThemePair, resolveActiveTheme } from "../src/lib/themes";

describe("Cabinet theme switching", () => {
  const original = new Map<string, PropertyDescriptor | undefined>();
  let storage: Map<string, string>;
  let properties: Map<string, string>;
  let attributes: Map<string, string>;
  let classes: Set<string>;
  let prefersDark: boolean;

  beforeEach(() => {
    storage = new Map();
    properties = new Map();
    attributes = new Map();
    classes = new Set();
    prefersDark = false;
    const links = new Map<string, { id: string; remove: () => void }>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const globals = {
      localStorage,
      window: { localStorage, matchMedia: () => ({ matches: prefersDark }) },
      document: {
        documentElement: {
          style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) },
          classList: { toggle: (key: string, enabled: boolean) => enabled ? classes.add(key) : classes.delete(key) },
          setAttribute: (key: string, value: string) => attributes.set(key, value),
          removeAttribute: (key: string) => attributes.delete(key),
        },
        getElementById: (id: string) => links.get(id) ?? null,
        createElement: () => ({ id: "", href: "", rel: "", remove() { links.delete(this.id); } }),
        head: { appendChild: (element: { id: string; remove: () => void }) => links.set(element.id, element) },
      },
    };
    for (const [key, value] of Object.entries(globals)) {
      original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });

  afterEach(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    original.clear();
  });

  it("uses the approved Cabinet pair by default", () => {
    assert.deepEqual(getStoredThemePair(), DEFAULT_THEME_PAIR);
    assert.equal(resolveActiveTheme()?.name, DEFAULT_THEME_PAIR.light);
    storage.set("theme", "dark");
    assert.equal(resolveActiveTheme()?.name, DEFAULT_THEME_PAIR.dark);
  });

  it("keeps an explicitly selected expressive theme", () => {
    storage.set("cabinet-theme", "forest");
    assert.equal(resolveActiveTheme()?.name, "forest");
  });

  it("follows the OS preference using the stored pair", () => {
    storage.set("cabinet-theme-mode", "system");
    storage.set("cabinet-theme-light", "sakura");
    storage.set("cabinet-theme-dark", "forest");
    assert.equal(resolveActiveTheme()?.name, "sakura");
    prefersDark = true;
    assert.equal(resolveActiveTheme()?.name, "forest");
  });

  it("recovers stale or wrong-mode pair entries", () => {
    storage.set("cabinet-theme-light", "forest");
    storage.set("cabinet-theme-dark", "removed-theme");
    assert.deepEqual(getStoredThemePair(), DEFAULT_THEME_PAIR);
    storage.set("cabinet-theme", "removed-theme");
    assert.equal(resolveActiveTheme()?.name, DEFAULT_THEME_PAIR.light);
  });

  it("clears theme-specific colors and document fonts when switching palettes", () => {
    applyTheme(findThemeByName("paper"));
    assert.equal(properties.get("--selection"), "#e8edfc");
    assert.match(properties.get("--font-document-theme") ?? "", /font-reading/);
    applyTheme(findThemeByName("forest"));
    assert.equal(properties.has("--selection"), false);
    assert.equal(properties.has("--primary-hover"), false);
    assert.match(properties.get("--font-document-theme") ?? "", /Fraunces/);
    assert.equal(classes.has("dark"), true);
    assert.equal(attributes.get("data-custom-theme"), "forest");
  });

  it("resets every theme-owned override when returning to default colors", () => {
    applyTheme(findThemeByName("cabinet-dark"));
    applyTheme(null);
    assert.equal(properties.size, 0);
    assert.equal(attributes.has("data-custom-theme"), false);
  });

  it("gives both Cabinet palettes readable text, actions, selection, and input boundaries", () => {
    function luminance(hex: string) {
      const channels = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    function contrast(a: string, b: string) {
      const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (values[0] + 0.05) / (values[1] + 0.05);
    }
    for (const name of Object.values(DEFAULT_THEME_PAIR)) {
      const vars = findThemeByName(name)!.vars;
      for (const [text, background] of [["--foreground", "--background"], ["--muted-foreground", "--background"], ["--primary-foreground", "--primary"], ["--selection-foreground", "--selection"]]) {
        assert.ok(contrast(vars[text], vars[background]) >= 4.5, `${name}: ${text} on ${background}`);
      }
      assert.ok(contrast(vars["--input"], vars["--background"]) >= 3, `${name}: input boundary`);
      assert.ok(contrast(vars["--ring"], vars["--background"]) >= 3, `${name}: focus ring`);
    }
  });
});
