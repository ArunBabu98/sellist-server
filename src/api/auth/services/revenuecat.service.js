// src/services/revenuecat.service.js
const RC_PROJECT_ID = process.env.RC_PROJECT_ID;
const RC_SECRET = process.env.RC_API_SECRET_KEY;
const RC_BASE = `https://api.revenuecat.com/v2/projects/${RC_PROJECT_ID}/customers`;

const FREE_AI_CREDITS = 5;
const FREE_LIST_TOKENS = 5;

async function seedFreeCredits(rcCustomerId) {
  const res = await fetch(
    `${RC_BASE}/${encodeURIComponent(rcCustomerId)}/virtual_currencies/transactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RC_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        adjustments: {
          AICRED: FREE_AI_CREDITS,
          LISTCRED: FREE_LIST_TOKENS,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RC seed failed [${res.status}]: ${body}`);
  }

  return res.json();
}

async function getBalances(rcCustomerId) {
  const res = await fetch(
    `${RC_BASE}/${encodeURIComponent(rcCustomerId)}/virtual_currencies`,
    {
      headers: { Authorization: `Bearer ${RC_SECRET}` },
    },
  );

  if (!res.ok) throw new Error(`RC balance fetch failed [${res.status}]`);
  return res.json();
}

async function deductCredits(rcCustomerId, currencyCode, amount) {
  const res = await fetch(
    `${RC_BASE}/${encodeURIComponent(rcCustomerId)}/virtual_currencies/transactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RC_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        adjustments: { [currencyCode]: -amount },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RC deduct failed [${res.status}]: ${body}`);
  }
}

module.exports = { seedFreeCredits, getBalances, deductCredits };
