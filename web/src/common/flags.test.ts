import { expect, test } from "bun:test";
import { parseFlags } from "./flags";

test("flags that no longer exist are ignored (pages was promoted)", () => {
  expect(parseFlags("pages")).toEqual([]);
  expect(parseFlags(" other , pages ")).toEqual([]);
  expect(parseFlags("")).toEqual([]);
});
