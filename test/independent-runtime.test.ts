import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { independentEndpoint, getRegistryRepository, isOriginalCabinetUrl } from "../src/lib/network/upstream-policy";
import { getRegistryTemplates } from "../src/lib/registry/registry-manifest";
import { downloadRegistryTemplate } from "../src/lib/registry/github-fetch";
import { fetchLatestReleaseManifest, readBundledReleaseManifest } from "../src/lib/system/release-manifest";
import { getReleaseManifestUrl } from "../src/lib/runtime/runtime-config";

describe("independent fork network boundaries", () => {
  const originalFetch = globalThis.fetch;
  const envNames = ["CABINET_RELEASE_MANIFEST_URL", "CABINET_REGISTRY_REPOSITORY"];
  const originalEnv = new Map<string, string | undefined>();
  let calls: string[];

  beforeEach(() => {
    for (const name of envNames) { originalEnv.set(name, process.env[name]); delete process.env[name]; }
    calls = [];
    globalThis.fetch = async input => { calls.push(String(input)); throw new Error("Unexpected network request"); };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it("does not check for releases or query a registry on a default install", async () => {
    assert.equal(getReleaseManifestUrl(), "");
    assert.deepEqual(await getRegistryTemplates(), []);
    const release = await fetchLatestReleaseManifest();
    assert.equal(release.source, "bundled");
    assert.equal(release.manifestUrl, "");
    assert.deepEqual(calls, []);
  });

  it("rejects legacy release configuration without contacting it", async () => {
    process.env.CABINET_RELEASE_MANIFEST_URL = "https://github.com/cabinetai/cabinet/releases/latest/download/cabinet-release.json";
    assert.equal(getReleaseManifestUrl(), "");
    assert.equal((await fetchLatestReleaseManifest()).source, "bundled");
    assert.deepEqual(calls, []);
  });

  it("rejects upstream registry configuration before any download or filesystem write", async () => {
    for (const repository of ["cabinetai/cabinets", "CABINETAI/cabinets", "hilash/cabinet"]) {
      process.env.CABINET_REGISTRY_REPOSITORY = repository;
      assert.equal(getRegistryRepository(), null);
      assert.deepEqual(await getRegistryTemplates(), []);
      await assert.rejects(downloadRegistryTemplate("sample", "/must-not-be-created"), /No template registry/);
    }
    assert.deepEqual(calls, []);
  });

  it("recognizes original web, GitHub, raw-content, legacy-owner, and native-update endpoints", () => {
    for (const url of [
      "https://reports.runcabinet.com/feedback", "https://app.runcabinet.com/login",
      "https://cabinets.sh", "https://www.cabinets.sh/templates",
      "https://github.com/CabinetAI/cabinet", "https://github.com/%63abinetai/cabinet",
      "https://api.github.com/repos/cabinetai/cabinet", "https://raw.githubusercontent.com/cabinetai/cabinets/HEAD/manifest.json",
      "https://codeload.github.com/hilash/cabinet/tar.gz/main", "https://update.electronjs.org/cabinetai/cabinet/darwin-arm64/0.5.3",
    ]) {
      assert.equal(isOriginalCabinetUrl(url), true, url);
      assert.equal(independentEndpoint(url), null, url);
    }
  });

  it("preserves independently configured services and user GitHub repositories", () => {
    for (const url of ["https://github.com/dominic-sylvester/cabinet", "https://api.github.com/repos/example/project", "http://127.0.0.1:9876/manifest.json"]) {
      assert.equal(isOriginalCabinetUrl(url), false);
      assert.equal(independentEndpoint(url), url);
    }
    process.env.CABINET_REGISTRY_REPOSITORY = "example/private-templates";
    assert.equal(getRegistryRepository(), "example/private-templates");
    for (const value of [undefined, "", "not a URL", "file:///etc/passwd", "https://user:password@example.com/manifest"]) assert.equal(independentEndpoint(value), null);
  });

  it("rejects a configured manifest that points downloads back at the original project", async () => {
    process.env.CABINET_RELEASE_MANIFEST_URL = "https://example.com/manifest.json";
    const bundled = await readBundledReleaseManifest();
    globalThis.fetch = async input => {
      calls.push(String(input));
      return Response.json({ ...bundled, sourceTarballUrl: "https://github.com/cabinetai/cabinet/archive/refs/tags/v0.5.3.tar.gz" });
    };
    const result = await fetchLatestReleaseManifest();
    assert.equal(result.source, "bundled");
    assert.deepEqual(calls, ["https://example.com/manifest.json"]);
  });

  it("can read an explicitly configured independent release manifest", async () => {
    process.env.CABINET_RELEASE_MANIFEST_URL = "https://example.com/manifest.json";
    const bundled = await readBundledReleaseManifest();
    globalThis.fetch = async input => { calls.push(String(input)); return Response.json({ ...bundled, version: "99.0.0" }); };
    const result = await fetchLatestReleaseManifest();
    assert.equal(result.source, "remote");
    assert.equal(result.manifest.version, "99.0.0");
    assert.deepEqual(calls, ["https://example.com/manifest.json"]);
  });
});
