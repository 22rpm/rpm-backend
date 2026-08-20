// migrations/20260818120400_create_patient_devices.js
//
// Clinical device assignment — SEPARATE from the telemetry `devices` table
// (which is the dev_id -> user mapping dev_data ingests against). This records
// the chart facts: device type, serial number, who assigned it, when, and the
// return/replacement lifecycle. A patient may have several; devices get replaced.
//
// device_type FKs the device_types lookup (only is_active types should be
// offered at enrollment). dev_id optionally links to the telemetry identifier so
// readings can be attributed to the assigned device.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("patient_devices");
  if (exists) return;

  await knex.schema.createTable("patient_devices", function (table) {
    table.bigIncrements("id").primary();

    table.integer("patient_id").unsigned().notNullable();
    table
      .foreign("patient_id")
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.integer("organization_id").unsigned().notNullable();
    table
      .foreign("organization_id")
      .references("id")
      .inTable("organizations")
      .onDelete("CASCADE");

    table.string("device_type", 32).notNullable();
    table.foreign("device_type").references("key").inTable("device_types");

    table.string("serial_number", 100).notNullable(); // recorded in chart
    table.string("dev_id", 255).nullable(); // links to telemetry devices.dev_id

    table.date("assigned_at").notNullable();
    table.integer("assigned_by").unsigned().nullable();
    table
      .foreign("assigned_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table.date("returned_at").nullable(); // null = currently active
    table
      .enu("status", ["active", "returned", "replaced"])
      .notNullable()
      .defaultTo("active");

    // Replacement chain: this row replaces an older assignment.
    table.bigInteger("replaces").unsigned().nullable();
    table
      .foreign("replaces")
      .references("id")
      .inTable("patient_devices")
      .onDelete("SET NULL");

    table.string("notes", 500).nullable();

    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["patient_id", "status"], "patient_devices_patient_status_index");
    table.index(["organization_id"], "patient_devices_org_index");
    // Non-unique for now — unsure whether serials are globally unique across
    // inventory; a UNIQUE we get wrong is worse than one added later.
    table.index(["serial_number"], "patient_devices_serial_index");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("patient_devices");
};
