/** Offline planning helper only: no file access, install hook, or live profile mutation.
 * Migrates ID-targeted overrides written for the upstream whale-pet plugin:
 * entry ID `whale-pet` and module `dsh-plugin-whale-pet` become this fork's IDs.
 */
export const OLD_ENTRY_ID = 'whale-pet';
export const NEW_ENTRY_ID = 'whale-chan-pet';
const MODULE_NAMES = ['dsh-plugin-whale-chan-pet', 'dsh-plugin-whale-pet', 'whale-pet'];

/** Plan migration of ordinary ID-targeted overrides, preserving all other values.
 * The caller must review and explicitly apply the resulting configuration.
 * Conflicting/custom insertions require manual review rather than guessing precedence.
 */
export function planEntryIdMigration(patches) {
  if (!Array.isArray(patches) || patches.some(p => !p || typeof p !== 'object' || Array.isArray(p))) {
    throw new TypeError('Expected a profile patch list');
  }
  const result = structuredClone(patches);
  const insertedIds = [];
  const visit = rows => {
    for (const row of rows ?? []) {
      insertedIds.push(row.id);
      if (row.group && Array.isArray(row.config)) visit(row.config);
    }
  };
  for (const patch of result) visit(patch.insert);
  if (insertedIds.includes(OLD_ENTRY_ID)) throw new Error('Custom old-ID insertion requires manual review');
  const old = result.filter(p => p.id === OLD_ENTRY_ID);
  if (!old.length) return result;
  if (result.some(p => p.id === NEW_ENTRY_ID) || insertedIds.includes(NEW_ENTRY_ID)) {
    throw new Error('Both entry IDs are present; review conflicting settings manually');
  }
  for (const patch of old) {
    if (patch.insert !== undefined || (patch.name !== undefined && !MODULE_NAMES.includes(patch.name))) {
      throw new Error('Unexpected old-ID target requires manual review');
    }
    patch.id = NEW_ENTRY_ID;
  }
  return result;
}
