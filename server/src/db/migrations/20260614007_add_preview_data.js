/**
 * Migration 7 — Add preview_data column to import_sessions.
 * Stores the full analyzed rows JSON so commitImport can re-use
 * the Phase-1 parse without re-reading the CSV file.
 */
exports.up = async function (knex) {
  await knex.schema.table('import_sessions', (t) => {
    t.text('preview_data').nullable();   // JSON-serialized analyzedRows array
  });
};

exports.down = async function (knex) {
  await knex.schema.table('import_sessions', (t) => {
    t.dropColumn('preview_data');
  });
};
