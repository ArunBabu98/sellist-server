// src/utils/deductSafe.js
async function deductSafe(req) {
  if (typeof req.deductCredits === "function") {
    await req.deductCredits();
  }
}

module.exports = { deductSafe };
