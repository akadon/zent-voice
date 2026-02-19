import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

async function runMigrations() {
  const pool = mysql.createPool({ uri: env.DATABASE_URL, connectionLimit: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrations complete");
}

runMigrations().catch(console.error);
