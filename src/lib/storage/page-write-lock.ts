export class PageWriteConflict extends Error {
  constructor(public reason: "revision_conflict" | "already_exists") {
    super(reason === "already_exists" ? "Page already exists" : "Page changed since it was read. Read it again before editing.");
  }
}

const processState = globalThis as typeof globalThis & { cabinetPageWrites?: Map<string, Promise<void>> };
const writes = processState.cabinetPageWrites ??= new Map<string, Promise<void>>();

export async function withPageWriteLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = writes.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  writes.set(file, current);
  await previous;
  try { return await action(); }
  finally { release(); if (writes.get(file) === current) writes.delete(file); }
}
