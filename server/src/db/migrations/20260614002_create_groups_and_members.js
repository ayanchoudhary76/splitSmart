/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('groups', (table) => {
      table.increments('id').primary();
      table.string('name', 100).notNullable();
      table.string('description', 500).nullable();
      table.integer('created_by').unsigned().references('id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('group_members', (table) => {
      table.increments('id').primary();
      table
        .integer('group_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('groups')
        .onDelete('CASCADE');
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.date('joined_at').notNullable();
      table.date('left_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index(['group_id', 'user_id']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('group_members')
    .dropTableIfExists('groups');
};
