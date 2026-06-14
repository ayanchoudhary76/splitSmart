/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('expenses', (table) => {
      table.increments('id').primary();
      table
        .integer('group_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('groups')
        .onDelete('CASCADE');
      table.string('description', 500).notNullable();
      table.decimal('amount', 12, 2).notNullable();
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.decimal('exchange_rate', 10, 4).notNullable().defaultTo(1.0);
      table.decimal('amount_inr', 12, 2).notNullable();
      table
        .integer('paid_by_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users');
      table.string('split_type', 20).notNullable();
      table.date('date').notNullable();
      table.boolean('is_settlement').notNullable().defaultTo(false);
      table.text('notes').nullable();
      table.integer('csv_row_number').nullable();
      table
        .integer('import_session_id')
        .unsigned()
        .nullable();
      // FK to import_sessions added in migration 5 via alter, since
      // import_sessions table doesn't exist yet at this point.
      table
        .integer('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index('group_id');
      table.index('paid_by_user_id');
      table.index('date');
      table.index('import_session_id');
    })
    .createTable('expense_splits', (table) => {
      table.increments('id').primary();
      table
        .integer('expense_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('expenses')
        .onDelete('CASCADE');
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users');
      table.string('participant_name', 100).nullable();
      table.decimal('share_amount', 12, 2).notNullable();
      table.string('split_detail', 100).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index('expense_id');
      table.index('user_id');
    })
    .then(() => {
      // CHECK: at least one of user_id or participant_name must be non-null
      return knex.raw(`
        ALTER TABLE expense_splits
        ADD CONSTRAINT chk_participant
        CHECK (user_id IS NOT NULL OR participant_name IS NOT NULL)
      `);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('expense_splits')
    .dropTableIfExists('expenses');
};
