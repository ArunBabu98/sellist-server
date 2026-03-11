const express = require("express");
const {
  verifyApiKey,
  authenticate,
} = require("../../../middleware/auth.middleware");
const { apiLimiter } = require("../../../middleware/rateLimit.middleware");
const geminiController = require("../controllers/gemini.controller");
const { requireCredits } = require("../../../middleware/credits.middleware");

const router = express.Router();

// All routes require API key + generic API limiter
router.use(verifyApiKey);
router.use(authenticate);
router.use(apiLimiter);

/**
 * @route   POST /api/ai/analyze-image
 * @desc    Analyze a single product image and generate listing
 * @access  Private (API Key required)
 * @body    { imageBase64: string, mimeType?: string, options?: object }
 */
router.post(
  "/analyze-image",
  requireCredits("AICRED", 1),
  geminiController.analyzeImage,
);

/**
 * @route   POST /api/ai/analyze-images
 * @desc    Analyze multiple images of the SAME product
 * @access  Private (API Key required)
 * @body    { images: [{ imageBase64: string, mimeType?: string }], options?: object }
 */
router.post(
  "/analyze-images",
  requireCredits("AICRED", 1),
  geminiController.analyzeImages,
);

/**
 * @route   POST /api/ai/analyze-bulk
 * @desc    Separate and analyze multiple DIFFERENT products from bulk upload
 * @access  Private (API Key required)
 * @body    { images: [{ imageBase64: string, mimeType?: string }], options?: object }
 */
router.post(
  "/analyze-bulk",
  requireCredits("AICRED", 1),
  geminiController.analyzeBulkProducts,
);

/**
 * @route   POST /api/ai/generate-html
 * @desc    Generate HTML template for a listing
 * @access  Private (API Key required)
 * @body    { listingData: object, options?: { customHtml?: string, hostedImageUrls?: string[], branding?: object } }
 */
router.post("/generate-html", geminiController.generateHtmlTemplate);

/**
 * @route   POST /api/ai/draft-terms
 * @desc    Draft seller Terms of Service
 * @access  Private (API Key required)
 * @body    { sellerInfo?: { businessName?: string, returnPeriod?: string, warrantyOffered?: boolean, ... } }
 */
router.post("/draft-terms", geminiController.draftTermsOfService);

module.exports = router;
