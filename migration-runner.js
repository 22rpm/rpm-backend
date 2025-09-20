// migration-runner.js
const { Sequelize } = require("sequelize");
const { Umzug, SequelizeStorage } = require("umzug");

// 1. Create sequelize instance
const sequelize = new Sequelize("rpm_db", "root", "root", {
  host: "localhost",
  dialect: "mysql", // or postgres
});

// 2. Configure Umzug (migration tool)
const umzug = new Umzug({
  migrations: { glob: "migrations/*.js" },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

// 3. Run migrations
const runMigrations = async () => {
  try {
    await sequelize.authenticate(); // check db connection
    await umzug.up(); // run all pending migrations
    console.log("Migrations executed successfully");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await sequelize.close();
  }
};x``

runMigrations();
