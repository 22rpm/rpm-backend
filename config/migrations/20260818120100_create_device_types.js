// migrations/20260818120100_create_device_types.js
//
// Device-type lookup. `key` is the value stored on patient_devices /
// rpm_device_setups and is intended to align with dev_data.dev_type so readings
// attribute to a device type. Lookup (not ENUM) so a new device type is a data
// change, not a migration, and so the raw-vs-chosen key mapping lives in data.
//
// Only 'bp' is verified against real device traffic. The other five are seeded
// INACTIVE with dev_data_type NULL until the vendor's actual dev_type string is
// confirmed — see CARE_ACTIVITY_NOTES.md. The enrollment form should offer only
// is_active = 1 types, so patients cannot be enrolled on an unverified device.

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("device_types");
  if (exists) return;

  await knex.schema.createTable("device_types", function (table) {
    // The stored key (e.g. 'bp'); also the FK target for device_type columns.
    table.string("key", 32).primary();
    table.string("label", 100).notNullable();
    // Verified mapping to dev_data.dev_type; NULL until confirmed from real traffic.
    table.string("dev_data_type", 32).nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex("device_types").insert([
    { key: "bp", label: "BP cuff", dev_data_type: "bp", is_active: true, sort_order: 1 },
    { key: "glucose", label: "Glucometer", dev_data_type: null, is_active: false, sort_order: 2 },
    { key: "spo2", label: "Pulse oximeter", dev_data_type: null, is_active: false, sort_order: 3 },
    { key: "weight", label: "Weight scale", dev_data_type: null, is_active: false, sort_order: 4 },
    { key: "peak_flow", label: "Peak flow meter", dev_data_type: null, is_active: false, sort_order: 5 },
    { key: "temperature", label: "Thermometer", dev_data_type: null, is_active: false, sort_order: 6 },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("device_types");
};
