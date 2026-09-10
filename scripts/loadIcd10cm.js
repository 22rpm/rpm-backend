// scripts/loadIcd10cm.js
//
// Loads the full ICD-10-CM code set into `icd10cm_codes` from the CMS "order file".
// Reference data, NO PHI. Run once at deploy and again on each annual (Oct 1) revision.
//
// WHERE TO GET THE FILE (manual, ~once a year — no live fetch baked in, so a moved CMS
// URL or a zip format change can never break a deploy):
//   1. https://www.cms.gov/medicare/coding-billing/icd-10-codes  →  the current fiscal
//      year's "Code Descriptions in Tabular Order" ZIP.
//   2. Unzip; inside is `icd10cm-order-<YEAR>.txt` (a.k.a. the order/addenda file).
//   3. Run:  node scripts/loadIcd10cm.js /path/to/icd10cm-order-2026.txt
//
// ORDER FILE FORMAT (fixed-width, one code per line):
//   cols  1-5   order number            (ignored)
//   col   6     blank
//   cols  7-13  ICD-10-CM code, dot-less, left-justified   e.g. "E1122  "
//   col   14    blank
//   col   15    billable flag: '1' = billable/valid, '0' = header/non-billable
//   col   16    blank
//   cols 17-76  short description (<=60 chars)
//   col   77    blank
//   cols 78-    long description
// Descriptions contain spaces, so the fields MUST be read by fixed offset, not split.
//
// The load is transactional: the whole table is replaced (DELETE + batched INSERT inside
// one transaction) so readers always see either the complete old set or the complete new
// set — never a half-loaded table. Safe to re-run (idempotent).

require("dotenv").config();
const fs = require("fs");
const pool = require("../config/db");

const BATCH = 1000;

function parseLine(line) {
  // Guard against short/blank lines.
  if (!line || line.length < 16) return null;
  const code = line.slice(6, 13).trim();
  if (!code) return null;
  const billable = line.slice(14, 15) === "1";
  const shortDesc = line.slice(16, 76).trim();
  const longDesc = line.slice(77).trim() || shortDesc;
  return { code, billable, shortDesc, longDesc };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/loadIcd10cm.js /path/to/icd10cm-order-<YEAR>.txt");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) rows.push(parsed);
  }
  if (rows.length === 0) {
    console.error("No codes parsed — check the file is the CMS order file (fixed-width).");
    process.exit(1);
  }
  const billableCount = rows.filter((r) => r.billable).length;
  console.log(`Parsed ${rows.length} codes (${billableCount} billable, ${rows.length - billableCount} header).`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM icd10cm_codes");
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = chunk.map((r) => [
        r.code,
        r.billable ? 1 : 0,
        r.shortDesc.slice(0, 80),
        r.longDesc.slice(0, 512),
        r.longDesc.toLowerCase().slice(0, 512),
      ]);
      await conn.query(
        "INSERT INTO icd10cm_codes (code, billable, short_desc, long_desc, search_desc) VALUES ?",
        [values]
      );
    }
    await conn.commit();
    const [[{ cnt }]] = await conn.query("SELECT COUNT(*) AS cnt FROM icd10cm_codes");
    console.log(`Loaded ${cnt} ICD-10-CM codes.`);
  } catch (err) {
    await conn.rollback();
    console.error("Load failed, rolled back:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { parseLine };

