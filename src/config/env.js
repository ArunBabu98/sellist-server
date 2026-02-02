// src/config/env.js
const path = require("path");
require("dotenv").config({
  path: path.resolve(process.cwd(), ".env"),
});
