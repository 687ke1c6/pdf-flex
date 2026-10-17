import { expect, test } from "bun:test";
import { parseFlags } from "./flags";

test("only known flags are kept, wherever they are in the list", () => {
  expect(parseFlags("pages")).toEqual(["pages"]);
  expect(parseFlags(" other , pages ")).toEqual(["pages"]);
  expect(parseFlags("")).toEqual([]);
  expect(parseFlags("Pages")).toEqual([]);
});
