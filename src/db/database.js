// src/db/database.js
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../../sellist.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   TEXT PRIMARY KEY,
    email                TEXT UNIQUE NOT NULL,
    password             TEXT NOT NULL,
    rc_id                TEXT UNIQUE,
    free_credits_seeded  INTEGER DEFAULT 0,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;
