const ORIGINAL_OWNERS = new Set(["cabinetai"]);

export function isOriginalCabinetUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (host === "runcabinet.com" || host.endsWith(".runcabinet.com") || host === "cabinetai.com" || host.endsWith(".cabinetai.com") || host === "cabinets.sh" || host.endsWith(".cabinets.sh")) return true;
  let segments: string[];
  try { segments = decodeURIComponent(url.pathname).toLowerCase().split("/").filter(Boolean); } catch { return true; }
  if (host === "api.github.com" && ["repos", "orgs", "users"].includes(segments[0])) segments.shift();
  if (["github.com", "www.github.com", "api.github.com", "raw.githubusercontent.com", "codeload.github.com", "update.electronjs.org"].includes(host)) {
    return ORIGINAL_OWNERS.has(segments[0]) || (segments[0] === "hilash" && ["cabinet", "cabinets", "cabinet-cloud"].includes(segments[1]));
  }
  return false;
}

export function independentEndpoint(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || isOriginalCabinetUrl(url.href)) return null;
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}

export function getRegistryRepository(): string | null {
  const repository = process.env.CABINET_REGISTRY_REPOSITORY?.trim();
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
  return isOriginalCabinetUrl(`https://github.com/${repository}`) ? null : repository;
}
