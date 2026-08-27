// config/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Client half of the tz contract: the mysql2 driver interprets DATETIME/
  // TIMESTAMP as UTC when parsing/serializing. This alone is not enough —
  // MySQL still renders TIMESTAMP columns and DATE_FORMAT/DATE() in the SERVER
  // SESSION timezone, which is UTC on prod but Pacific (SYSTEM) on dev. See the
  // pin below and TZ_FIX_DESIGN.md #11/#12.
  timezone: 'Z',
});

// Server half of the tz contract (TZ_FIX_DESIGN.md PR 2): pin every pooled
// connection's session to UTC so the server renders timestamps and buckets
// DATE_FORMAT/DATE() the same on every environment. This is a NO-OP on prod
// (its session is already UTC) and moves ONLY dev (PDT/PST -> UTC) onto prod's
// baseline, so there is a single code path. Fires once per physical connection
// at creation; the session tz persists for the connection's lifetime. Runs
// before any app query on that connection (mysql2 is FIFO per connection).
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (err) => {
    if (err) {
      // A connection that could not be pinned would silently bucket in the
      // server's local tz — the exact bug this prevents — so surface it loudly
      // rather than serving mis-bucketed billing counts.
      console.error("Failed to pin DB session time_zone to UTC:", err.message);
    }
  });
});

module.exports = pool;
