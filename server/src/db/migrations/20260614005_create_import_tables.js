/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('import_sessions', (table) => {
      table.increments('id').primary();
      table
        .integer('group_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('groups');
      table.string('filename', 255).notNullable();
      table
        .integer('imported_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users');
      table.string('status', 20).notNullable().defaultTo('pending');
      table.integer('total_rows').defaultTo(0);
      table.integer('imported_rows').defaultTo(0);
      table.integer('skipped_rows').defaultTo(0);
      table.integer('flagged_rows').defaultTo(0);
      table.decimal('usd_rate_used', 10, 4).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at').nullable();
    })
    .createTable('import_anomalies', (table) => {
      table.increments('id').primary();
      table
        .integer('import_session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('import_sessions')
        .onDelete('CASCADE');
      table.integer('csv_row_number').notNullable();
      table.string('anomaly_type', 50).notNullable();
      table.text('description').notNullable();
      table.text('original_data').notNullable();
      table.string('action_taken', 50).notNullable();
      table.timestamp('resolved_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index('import_session_id');
    })
    .then(() => {
      // Now that import_sessions exists, add the FK on expenses.import_session_id
      return knex.schema.alterTable('expenses', (table) => {
        table
          .foreign('import_session_id')
          .references('id')
          .inTable('import_sessions');
      });
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('expenses', (table) => {
      table.dropForeign('import_session_id');
    })
    .then(() => {
      return knex.schema
        .dropTableIfExists('import_anomalies')
        .dropTableIfExists('import_sessions');
    });
};
