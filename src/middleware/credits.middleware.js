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

      if (!user?.rc_id) {
        return res.status(402).json({
          error: "insufficient_credits",
          message: "Account not fully set up. Please restart the app.",
        });
      }

      const data = await getBalances(user.rc_id);
      const balance =
        data.items?.find((i) => i.currency_code === currencyCode)?.balance ?? 0;

      if (balance < amount) {
        return res.status(402).json({
          error: "insufficient_credits",
          currency: currencyCode,
          required: amount,
          current: balance,
        });
      }

      // Attach deduct fn — called after successful action
      req.deductCredits = () => deductCredits(user.rc_id, currencyCode, amount);
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { requireCredits };
