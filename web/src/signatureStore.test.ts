import { expect, test } from "bun:test";
import { exportSignatures, parseSignatureExport, type StoredSignature } from "./signatureStore";

const sig = (id: string, bytes: number[]): StoredSignature => ({
  id,
  name: `Sig ${id}`,
  source: "import",
  png: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
  width: 30,
  height: 10,
  createdAt: 1,
  lastUsedAt: 2,
});

test("export then import round-trips signatures with fresh ids", async () => {
  // Includes every byte value, to check the base64 encoding.
  const original = [sig("a", [137, 80, 78, 71]), sig("b", Array.from({ length: 256 }, (_, i) => i))];
  const imported = parseSignatureExport(await exportSignatures(original));

  expect(imported).toHaveLength(2);
  for (const [before, after] of original.map((s, i) => [s, imported[i]] as const)) {
    expect(after.id).not.toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.width).toBe(before.width);
    expect(new Uint8Array(await after.png.arrayBuffer())).toEqual(new Uint8Array(await before.png.arrayBuffer()));
  }
});

test("rejects files that aren't signature exports", () => {
  expect(() => parseSignatureExport(JSON.stringify({ hello: "world" }))).toThrow("isn't a pdf-sign signatures file");
  expect(() => parseSignatureExport("not json")).toThrow();
});
