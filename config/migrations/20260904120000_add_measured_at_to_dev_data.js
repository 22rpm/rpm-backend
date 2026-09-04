// Add dev_data.measured_at — the reading's true MEASUREMENT time (device clock),
// distinct from created_at (server RECEIPT time). See MEASURED_AT_PLAN.md /
// BILLING_FOLLOWUPS #16. NULLABLE with NO value backfill on purpose: every existing
// row (and any reading from an app version that predates the client change) stays NULL,
// and the 99454 day-count reads COALESCE(measured_at, created_at) so those rows keep
// bucketing on created_at exactly as today. Stored in UTC (the count does
// CONVERT_TZ(col,'+00:00',tz), which treats the column as UTC).

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn("dev_data", "measured_at");
  if (has) return;
  await knex.schema.alterTable("dev_data", (t) => {
    t.datetime("measured_at").nullable();
    t.index(["user_id", "measured_at"], "dev_data_user_measured_idx");
  });
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn("dev_data", "measured_at");
  if (!has) return;
  await knex.schema.alterTable("dev_data", (t) => {
    t.dropIndex(["user_id", "measured_at"], "dev_data_user_measured_idx");
    t.dropColumn("measured_at");
  });
};
