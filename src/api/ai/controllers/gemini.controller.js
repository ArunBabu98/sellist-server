// controllers/gemini.controller.js

const geminiService = require("../services/gemini2.service");
const {
  successResponse,
  errorResponse,
} = require("../../../utils/apiResponse");
const logger = require("../../../config/logger.config");

class GeminiController {
  /**
   * Analyze a single product image
   * POST /api/ai/analyze-image
   */
  async analyzeImage(req, res) {
    try {
      const { imageBase64, mimeType, options } = req.body;

      if (!imageBase64) {
        return errorResponse(res, "imageBase64 is required", 400);
      }

      logger.info("AI analyzeImage called");

      // Single image is just an array with one element
      const normalized = [
        {
          base64: imageBase64,
          mimeType: mimeType || "image/jpeg",
        },
      ];

      const listingPayload = await geminiService.analyzeMultipleImages(
        normalized,
        options || {}
      );

      // Handle rejection cases
      if (listingPayload.rejected) {
        return errorResponse(
          res,
          "Product rejected: eBay policy violation",
          403,
          {
            reason: listingPayload.reason,
            details: listingPayload.details,
            guidance:
              listingPayload.details?.compliance?.reason ||
              "This item cannot be sold on eBay",
          }
        );
      }

      if (listingPayload.requiresReview) {
        return errorResponse(res, "Product requires manual review", 422, {
          reason: listingPayload.reason,
          details: listingPayload.details,
          guidance:
            listingPayload.details?.recommendations?.guidance ||
            "Please verify product details manually",
        });
      }

      return successResponse(res, listingPayload, "Analysis successful");
    } catch (err) {
      logger.error("AI analyzeImage failed", {
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(res, "AI image analysis failed", 500, err.message);
    }
  }

  /**
   * Analyze multiple images of the SAME product
   * POST /api/ai/analyze-images
   */
  async analyzeImages(req, res) {
    const requestId = `req-${Date.now()}`;

    try {
      const { images, options } = req.body;
      // images: [{ imageBase64: string, mimeType?: string }, ...]

      // =====================================================================
      // VALIDATION
      // =====================================================================
      if (!Array.isArray(images) || images.length === 0) {
        return errorResponse(
          res,
          "images array is required and must not be empty",
          400,
          {
            field: "images",
            expected: "array of { imageBase64, mimeType }",
            received: typeof images,
          }
        );
      }

      // Validate each image
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img.imageBase64) {
          return errorResponse(
            res,
            `Image at index ${i} is missing imageBase64 data`,
            400,
            {
              field: `images[${i}].imageBase64`,
              expected: "base64 string",
            }
          );
        }

        // Validate MIME type
        const validMimeTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
        ];
        const mimeType = img.mimeType || "image/jpeg";
        if (!validMimeTypes.includes(mimeType)) {
          return errorResponse(
            res,
            `Image at index ${i} has invalid MIME type: ${mimeType}`,
            400,
            {
              field: `images[${i}].mimeType`,
              expected: validMimeTypes,
              received: mimeType,
            }
          );
        }
      }

      // Validate image count
      if (images.length > 16) {
        return errorResponse(
          res,
          "Too many images. Maximum 16 images allowed per request",
          400,
          {
            field: "images",
            maxAllowed: 16,
            received: images.length,
          }
        );
      }

      logger.info("AI analyzeImages called", {
        requestId,
        count: images.length,
        hasMarketData: !!options?.marketData?.length,
        hasSellerConfig: !!options?.sellerConfig,
      });

      // =====================================================================
      // NORMALIZE & CALL SERVICE
      // =====================================================================
      const normalized = images.map((img) => ({
        base64: img.imageBase64,
        mimeType: img.mimeType || "image/jpeg",
      }));

      const listingPayload = await geminiService.analyzeMultipleImages(
        normalized,
        {
          userProvidedCondition: options?.userProvidedCondition || null,
          marketData: options?.marketData || [],
          sellerConfig: options?.sellerConfig || {},
          hostedImageUrls: options?.hostedImageUrls || [],
        }
      );

      // =====================================================================
      // HANDLE REJECTION (eBay Policy Violation)
      // =====================================================================
      if (listingPayload.rejected) {
        logger.warn("analyzeImages:rejected", {
          requestId,
          reason: listingPayload.reason,
          violationCategory:
            listingPayload.details?.compliance?.violationCategory,
        });

        return errorResponse(
          res,
          "Product cannot be listed on eBay due to policy violation",
          403,
          {
            reason: listingPayload.reason,
            violationCategory:
              listingPayload.details?.compliance?.violationCategory,
            violationReason: listingPayload.details?.compliance?.reason,
            restrictionLevel: listingPayload.details?.compliance?.level,
            guidance:
              listingPayload.details?.recommendations?.guidance ||
              "This item is prohibited on eBay marketplace",
            processingTime: listingPayload.metadata?.processingTime,
          }
        );
      }

      // =====================================================================
      // HANDLE MANUAL REVIEW REQUIRED
      // =====================================================================
      if (listingPayload.requiresReview) {
        logger.info("analyzeImages:requiresReview", {
          requestId,
          reason: listingPayload.reason,
          guidance: listingPayload.details?.recommendations?.guidance,
        });

        return errorResponse(
          res,
          "Product requires manual review before listing",
          422,
          {
            reason: listingPayload.reason,
            confidence:
              listingPayload.details?.productIdentification?.confidence,
            restrictionLevel: listingPayload.details?.compliance?.level,
            guidance:
              listingPayload.details?.recommendations?.guidance ||
              "Unable to verify product details with high confidence",
            additionalChecksNeeded:
              listingPayload.details?.recommendations?.additionalChecksNeeded ||
              [],
            processingTime: listingPayload.metadata?.processingTime,
          }
        );
      }

      // =====================================================================
      // SUCCESS - Return Complete Listing Payload
      // =====================================================================
      logger.info("analyzeImages:success", {
        requestId,
        brand: listingPayload.productIdentification?.brand,
        category: listingPayload.productIdentification?.category,
        price: listingPayload.pricing?.suggestedPrice,
        processingTime: listingPayload.metadata?.processingTime,
      });

      return successResponse(
        res,
        listingPayload,
        "Multi-image analysis successful"
      );
    } catch (err) {
      logger.error("AI analyzeImages failed", {
        requestId,
        error: err.message,
        stack: err.stack,
      });

      // Check for specific error types
      if (err.message.includes("Too many images")) {
        return errorResponse(res, err.message, 400);
      }

      if (err.message.includes("Image too large")) {
        return errorResponse(res, err.message, 413);
      }

      if (err.message.includes("Unsupported mime type")) {
        return errorResponse(res, err.message, 415);
      }

      return errorResponse(
        res,
        "AI multi-image analysis failed",
        500,
        err.message
      );
    }
  }

  /**
   * Bulk mode: Separate multiple products from uploaded images
   * POST /api/ai/analyze-bulk
   */
  async analyzeBulkProducts(req, res) {
    const requestId = `bulk-${Date.now()}`;

    try {
      const { images, options } = req.body;

      if (!Array.isArray(images) || images.length === 0) {
        return errorResponse(
          res,
          "images array is required for bulk analysis",
          400
        );
      }

      logger.info("AI analyzeBulkProducts called", {
        requestId,
        count: images.length,
      });

      const normalized = images.map((img) => ({
        base64: img.imageBase64,
        mimeType: img.mimeType || "image/jpeg",
      }));

      // TODO: Implement bulk product separation logic
      // For now, return placeholder
      const products = await geminiService.analyzeBulkProducts(
        normalized,
        options || {}
      );

      logger.info("AI analyzeBulkProducts succeeded", {
        requestId,
        productsDetected: products.length,
      });

      return successResponse(
        res,
        { products },
        `Successfully separated ${products.length} product(s)`
      );
    } catch (err) {
      logger.error("AI analyzeBulkProducts failed", {
        requestId,
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(res, "AI bulk analysis failed", 500, err.message);
    }
  }

  /**
   * Generate HTML template for a listing
   * POST /api/ai/generate-html
   */
  async generateHtmlTemplate(req, res) {
    const requestId = `html-${Date.now()}`;

    try {
      const { listingData, options } = req.body;

      if (!listingData) {
        return errorResponse(res, "listingData is required", 400);
      }

      logger.info("AI generateHtmlTemplate called", { requestId });

      const html = await geminiService.generateHtmlTemplate(
        listingData,
        options || {}
      );

      return successResponse(res, { html }, "HTML template generated");
    } catch (err) {
      logger.error("AI generateHtmlTemplate failed", {
        requestId,
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(
        res,
        "HTML template generation failed",
        500,
        err.message
      );
    }
  }

  /**
   * Draft seller Terms of Service
   * POST /api/ai/draft-terms
   */
  async draftTermsOfService(req, res) {
    const requestId = `terms-${Date.now()}`;

    try {
      const { sellerInfo } = req.body;

      logger.info("AI draftTermsOfService called", { requestId });

      const terms = await geminiService.draftTermsOfService(sellerInfo || {});

      return successResponse(res, terms, "Terms of Service drafted");
    } catch (err) {
      logger.error("AI draftTermsOfService failed", {
        requestId,
        error: err.message,
        stack: err.stack,
      });
      return errorResponse(
        res,
        "Terms of Service generation failed",
        500,
        err.message
      );
    }
  }
}

module.exports = new GeminiController();
