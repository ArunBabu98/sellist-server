const express = require("express");
const authController = require("../controllers/auth.controller");
const draftingController = require("../controllers/drafting.controller");
const listingController = require("../controllers/listing.controller");
const taxonomyController = require("../controllers/taxonomy.controller");
const mediaController = require("../controllers/media.controller");
const setupController = require("../controllers/setup.controller");
const {
  verifyApiKey,
  authenticate,
  verifyBearerToken,
} = require("../../../middleware/auth.middleware");
const { tokenLimiter } = require("../../../middleware/rateLimit.middleware");
const { requireCredits } = require("../../../middleware/credits.middleware");

const router = express.Router();

// All routes require API key
router.use(verifyApiKey);

// Auth routes
router.get("/auth-url", authenticate, authController.generateAuthUrl);
router.post(
  "/exchange-token",
  tokenLimiter,
  authenticate,
  authController.exchangeToken,
);
router.post(
  "/refresh-token",
  tokenLimiter,
  authenticate,
  authController.refreshToken,
);
router.get("/user-profile", verifyBearerToken, authController.getUserProfile);
router.get("/get-token", verifyBearerToken, authController.getToken);

// Taxonomy routes
router.post("/suggest-category", taxonomyController.suggestCategory);
router.get(
  "/category-aspects/:categoryId",
  taxonomyController.getCategoryAspects,
);

// Drafting
router.post(
  "/draft/batch",
  verifyBearerToken,
  draftingController.batchCreateDrafts,
);

router.get("/drafts", verifyBearerToken, draftingController.getDraftOffers);

// Listing routes
router.post(
  "/publish-listing",
  verifyBearerToken,
  requireCredits("LISTCRED", 1),
  listingController.publishListing,
);

// Media routes
router.post("/upload-image", verifyBearerToken, mediaController.uploadImage);

// Setup routes
// Setup routes
router.post(
  "/opt-in-policies",
  verifyBearerToken,
  setupController.optInPolicies,
);

router.post(
  "/create-location",
  verifyBearerToken,
  setupController.createLocation,
);

// ✅ NEW
router.get("/policies", verifyBearerToken, setupController.getPolicies);

router.get("/locations", verifyBearerToken, setupController.getLocations);

// Listing routes
router.post(
  "/publish-offer",
  verifyBearerToken,
  authenticate,
  requireCredits("LISTCRED", 1),
  listingController.publishDraftOffer,
);

module.exports = router;
