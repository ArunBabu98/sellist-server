const express = require("express");
const { verifyApiKey } = require("../../../middleware/auth.middleware");
const { apiLimiter } = require("../../../middleware/rateLimit.middleware");
const geminiController = require("../controllers/gemini.controller");

const router = express.Router();

// All routes require API key + generic API limiter
router.use(verifyApiKey);
router.use(apiLimiter);

// POST /api/ai/analyze-image
router.post("/analyze-image", geminiController.analyzeImage);

// POST /api/ai/analyze-images
router.post("/analyze-images", geminiController.analyzeImages);

module.exports = router;
