/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('settlements', (table) => {
    table.increments('id').primary();
    table
      .integer('group_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('groups')
      .onDelete('CASCADE');
    table
      .integer('from_user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users');
    table
      .integer('to_user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users');
    table.decimal('amount', 12, 2).notNullable();
    table.date('date').notNullable();
    table.text('notes').nullable();
    table
      .integer('created_by')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('settlements');
};
