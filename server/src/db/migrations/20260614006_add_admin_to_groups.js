/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // 1. Add column as nullable first
  await knex.schema.alterTable('groups', (table) => {
    table
      .integer('admin_user_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('users');
  });

  // 2. Backfill existing rows: admin = whoever created the group
  await knex.raw('UPDATE groups SET admin_user_id = created_by');

  // 3. Now make it NOT NULL
  await knex.schema.alterTable('groups', (table) => {
    table.integer('admin_user_id').notNullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('groups', (table) => {
    table.dropColumn('admin_user_id');
  });
};
