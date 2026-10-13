// The signature library, persisted in IndexedDB.
import type { Stroke } from "./drawing";
import { run } from "./db";

export type SignatureSource = "import" | "typed" | "drawn";

/** How a typed or drawn signature was made; kept so it could be re-rendered (e.g. as vectors) later. */
export type SignatureRecipe =
  | { kind: "typed"; text: string; font: string; color: string }
  | { kind: "drawn"; strokes: Stroke[]; width: number; height: number; color: string };

export interface StoredSignature {
  id: string;
  name: string;
  source: SignatureSource;
  /** Transparent PNG. */
  png: Blob;
  /** Pixel size of the PNG. */
  width: number;
  height: number;
  createdAt: number;
  lastUsedAt: number;
  recipe?: SignatureRecipe;
}

export const newSignatureId = () => `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const signatureStore = {
  /** All saved signatures, most recently used first. */
  async list(): Promise<StoredSignature[]> {
    const all = await run("signatures", "readonly", (s) => s.getAll() as IDBRequest<StoredSignature[]>);
    return all.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  },
  put: (sig: StoredSignature) => run("signatures", "readwrite", (s) => s.put(sig)),
  remove: (id: string) => run("signatures", "readwrite", (s) => s.delete(id)),
};

/** Asks the browser not to evict our storage under pressure. Best effort; ignored if unsupported. */
export async function requestPersistence() {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();
  } catch {
    // Not available (e.g. some private modes); the library still works for this session.
  }
}

// --- Export / import as a file ---

const EXPORT_FORMAT = "pdf-flex-signatures";
/** Written before the app was renamed from pdf-sign; still accepted on import. */
const LEGACY_EXPORT_FORMAT = "pdf-sign-signatures";

interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 1;
  signatures: (Omit<StoredSignature, "id" | "png"> & { png: string })[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Serialises signatures to a JSON file's contents. */
export async function exportSignatures(signatures: StoredSignature[]): Promise<string> {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: 1,
    signatures: await Promise.all(
      signatures.map(async ({ id: _id, png, ...rest }) => ({ ...rest, png: await blobToBase64(png) })),
    ),
  };
  return JSON.stringify(file, null, 2);
}

/** Parses an export file into new signatures (fresh ids). Throws on anything that isn't one. */
export function parseSignatureExport(text: string): StoredSignature[] {
  const file = JSON.parse(text) as Partial<Omit<ExportFile, "format">> & { format?: string };
  if ((file.format !== EXPORT_FORMAT && file.format !== LEGACY_EXPORT_FORMAT) || file.version !== 1 || !Array.isArray(file.signatures)) {
    throw new Error("This isn't a pdf-flex signatures file.");
  }
  return file.signatures.map((s) => ({
    ...s,
    id: newSignatureId(),
    png: base64ToBlob(s.png, "image/png"),
  }));
}
