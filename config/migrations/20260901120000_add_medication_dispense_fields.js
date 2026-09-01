// migrations/20260901120000_add_medication_dispense_fields.js
//
// Reorder timing (medications #3, Option B). To PROJECT how many days of a medication a
// patient has left, capture what the pharmacy label states about the current fill:
//   - dispense_quantity : units dispensed ("Qty: 30")
//   - last_filled_date  : when this fill was dispensed (the clock's start)
//   - refills_remaining : authorized refills left ("Refill 9" -> 9)
//
// The projection (dispense_quantity / consumption rate, minus days elapsed) is derived
// in the read model and always presented as an ESTIMATE — consumption is assumed from
// patient-reported dose + frequency, so it is never stated as a hard date.
//
// refills_remaining is captured separately and matters as much as the date: 0 refills
// means the patient needs a NEW prescription (a different action, longer lead time), not
// a reorder — surfaced distinctly from "running low".
//
// All nullable: populated from OCR or manual entry when the label provides them (the
// barcode/NDC does not carry dispense data), absent otherwise.

exports.up = async function (knex) {
  const hasQty = await knex.schema.hasColumn("patient_medications", "dispense_quantity");
  const hasDate = await knex.schema.hasColumn("patient_medications", "last_filled_date");
  const hasRef = await knex.schema.hasColumn("patient_medications", "refills_remaining");
  await knex.schema.alterTable("patient_medications", function (table) {
    if (!hasQty) table.decimal("dispense_quantity", 10, 2).nullable();
    if (!hasDate) table.date("last_filled_date").nullable();
    if (!hasRef) table.integer("refills_remaining").nullable();
  });
};

exports.down = async function (knex) {
  const hasQty = await knex.schema.hasColumn("patient_medications", "dispense_quantity");
  const hasDate = await knex.schema.hasColumn("patient_medications", "last_filled_date");
  const hasRef = await knex.schema.hasColumn("patient_medications", "refills_remaining");
  await knex.schema.alterTable("patient_medications", function (table) {
    if (hasQty) table.dropColumn("dispense_quantity");
    if (hasDate) table.dropColumn("last_filled_date");
    if (hasRef) table.dropColumn("refills_remaining");
  });
};
