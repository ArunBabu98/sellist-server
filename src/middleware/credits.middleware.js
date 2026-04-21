// src/middleware/credits.middleware.js
const db = require("../db/database");
const {
  getBalances,
  deductCredits,
} = require("../api/auth/services/revenuecat.service");

const requireCredits = (currencyCode, amount) => {
  return async (req, res, next) => {
    try {
      const user = db
        .prepare("SELECT rc_id FROM users WHERE id = ?")
        .get(req.userId);

      console.log(
        `[requireCredits] userId=${req.userId} | rc_id=${user?.rc_id} | checking ${currencyCode}>=${amount}`,
      );

      if (!user?.rc_id) {
        return res.status(402).json({
          error: "insufficient_credits",
          message: "Account not fully set up. Please restart the app.",
        });
      }

      const data = await getBalances(user.rc_id);

      console.log(`[requireCredits] RC response: ${JSON.stringify(data)}`);

      const balance =
        data.items?.find((i) => i.currency_code === currencyCode)?.balance ?? 0;

      console.log(
        `[requireCredits] ${currencyCode} balance=${balance} | required=${amount} | pass=${balance >= amount}`,
      );

      if (balance < amount) {
        return res.status(402).json({
          error: "insufficient_credits",
          currency: currencyCode,
          required: amount,
          current: balance,
        });
      }

      req.deductCredits = () => deductCredits(user.rc_id, currencyCode, amount);
      next();
    } catch (err) {
      console.error(`[requireCredits] ERROR: ${err.message}`);
      next(err);
    }
  };
};

module.exports = { requireCredits };
