import assert from "node:assert/strict";
import { test } from "node:test";
import { cn } from "../src/lib/utils";

test("semantic type sizes keep foreground colors on compact buttons and badges", () => {
  for (const size of ["text-ui", "text-meta", "text-label", "text-reading"]) {
    for (const classes of [[size, "text-primary-foreground"], ["text-status-success", size]]) {
      const result = cn(...classes).split(" ");
      assert.ok(result.includes(size));
      assert.equal(result.length, 2);
    }
  }
});

test("standard and semantic font sizes can override each other", () => {
  assert.equal(cn("text-ui", "text-sm"), "text-sm");
  assert.equal(cn("text-sm", "text-reading"), "text-reading");
  assert.equal(cn("text-meta", "text-label"), "text-label");
});

test("semantic colors still override other foreground colors", () => {
  assert.equal(cn("text-primary-foreground", "text-status-success"), "text-status-success");
});
