import { expect, test } from "bun:test";
import { cleanFileName, suggestedName } from "./download";

test("the suggested name adds _edited before .pdf, and says where it is", () => {
  const s = suggestedName("Lease agreement.PDF");
  expect(s.name).toBe("Lease agreement_edited.pdf");
  expect(s.name.slice(s.suffixStart, s.suffixEnd)).toBe("_edited");
  expect(suggestedName("notes").name).toBe("notes_edited.pdf");
});

test("typed names are made safe and end in .pdf", () => {
  expect(cleanFileName("lease_signed")).toBe("lease_signed.pdf");
  expect(cleanFileName("  lease_signed.pdf  ")).toBe("lease_signed.pdf");
  expect(cleanFileName("a/b:c*d?.pdf")).toBe("a-b-c-d-.pdf");
  expect(cleanFileName("trailing dots...")).toBe("trailing dots.pdf");
  expect(cleanFileName("   ")).toBe("");
  expect(cleanFileName(".pdf")).toBe("");
});
