exports.up = function(knex) {
  return knex.schema.alterTable('settlements', table => {
    table.integer('import_session_id').unsigned().nullable();
    table.foreign('import_session_id').references('id').inTable('import_sessions').onDelete('SET NULL');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('settlements', table => {
    table.dropColumn('import_session_id');
  });
};
