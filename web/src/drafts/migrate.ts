// Upgrading stored drafts to the current shape (see docs/draft-identity-plan.md).
// Pure, so it's tested here and run by the database upgrade (common/db.ts).
import type { Draft } from "./draftStore";

/**
 * A version 1 draft as version 2. Version 1 drafts were keyed by their document's
 * hash and stored its PDF under that key; `sources` listed only PDFs inserted
 * into it (if any). The document becomes their first source, under the same id.
 */
export function migrateDraft(old: Draft): Draft {
  if (old.version >= 2) return old;
  const inserted = (old.sources ?? []).filter((s) => s.id !== old.id);
  return { ...old, version: 2, sources: [{ id: old.id, name: old.name }, ...inserted] };
}

/** Where a version 1 draft's own PDF moves to: `<id>` becomes `<id>:<id>`. Null for keys already in the new form. */
export const migrateFileKey = (key: string): string | null => (key.includes(":") ? null : `${key}:${key}`);
