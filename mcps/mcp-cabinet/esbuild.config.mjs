import esbuild from "esbuild";
await esbuild.build({ entryPoints: ["src/index.ts", "src/hermes.ts", "src/hermes-worker.ts"], outdir: "dist", bundle: true, platform: "node", format: "esm", target: "node20", packages: "external", banner: { js: "#!/usr/bin/env node" } });
console.log("Built Cabinet and Hermes MCP bridges.");
