import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 10,
  idleTimeout: 60000,
  connectTimeout: 10000,
  enableKeepAlive: true,
});

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
