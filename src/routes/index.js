const express = require("express");
const ebayRoutes = require("../api/ebay/routes/ebay.routes");
const aiRoutes = require("../api/ai/routes/ai.routes");
const { apiLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();

// Apply rate limiting to all API routes
router.use(apiLimiter);

// Mount routes
router.use("/ebay", ebayRoutes);
router.use("/ai", aiRoutes);

module.exports = router;
