// services/gemini.service.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const config = require("../../../config");
const logger = require("../../../config/logger.config");

class GeminiService {
  constructor() {
    if (!config.ai.geminiApiKey) {
      throw new Error("Gemini API key is required");
    }

    this.genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    this.modelName = "gemini-2.5-flash";

    // ✅ FIX: Lazy load AIAgentic to avoid circular dependency
    this._aiAgentic = null;

    this.maxRetries = 3;
    this.initialDelayMs = 1500;

    this.MAX_IMAGES_PER_REQUEST = 16;
    this.MAX_IMAGE_SIZE_MB = 20;
    this.ALLOWED_MIME_TYPES = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
  }

  // ✅ FIX: Getter for lazy loading
  get aiAgentic() {
    if (!this._aiAgentic) {
      this._aiAgentic = require("./ai.agentic");
    }
    return this._aiAgentic;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  async analyzeMultipleImages(images, options = {}) {
    const startTime = Date.now();
    const correlationId = this._correlationId();

    logger.info("Starting multi-image analysis", {
      correlationId,
      imageCount: images?.length,
    });

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("Images array must not be empty");
    }

    if (images.length > this.MAX_IMAGES_PER_REQUEST) {
      throw new Error(
        `Too many images. Maximum ${this.MAX_IMAGES_PER_REQUEST} allowed`
      );
    }

    // Validate and prepare buffers
    const buffers = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      this._validateImage(img.base64, img.mimeType);

      const buffer = Buffer.from(img.base64, "base64");
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

      logger.debug("Image validation passed", {
        mimeType: img.mimeType || "image/jpeg",
        sizeMB,
      });

      buffers.push({
        index: i,
        mimeType: img.mimeType || "image/jpeg",
        buffer,
      });
    }

    // =========================================================================
    // PHASE 0: Image Quality & Role Assignment
    // =========================================================================
    // let visualAnalysis = null;
    let selectedBuffers = buffers;

    // try {
    //   visualAnalysis = await this._retryWithBackoff(
    //     () => this.aiAgentic.visualImageID(buffers, correlationId),
    //     "visualImageID",
    //     correlationId
    //   );

    //   selectedBuffers = buffers.filter((b) =>
    //     visualAnalysis.summary.recommendedForAI.includes(b.index)
    //   );

    //   if (selectedBuffers.length === 0) {
    //     logger.warn("Phase 0 rejected all images, using fallback", {
    //       correlationId,
    //     });
    //     selectedBuffers = [buffers[0]];
    //   }

    //   logger.info("Phase 0 complete", {
    //     correlationId,
    //     usableImages: visualAnalysis.summary.usableImages,
    //     selectedCount: selectedBuffers.length,
    //   });
    // } catch (err) {
    //   logger.error("Phase 0 failed, continuing with all images", {
    //     correlationId,
    //     error: err.message,
    //   });
    //   selectedBuffers = buffers;
    // }

    // =========================================================================
    // PHASE 1: Visual Grounding - Product ID + Compliance
    // =========================================================================
    logger.info("Starting Phase 1: Visual Grounding", { correlationId });

    const groundingResult = await this._retryWithBackoff(
      () => this.aiAgentic.visualGrounding(selectedBuffers, correlationId),
      "visualGrounding",
      correlationId
    );

    logger.info("Phase 1 complete", {
      correlationId,
      compliant: groundingResult.compliance.isEbayCompliant,
      confidence: groundingResult.productIdentification.confidence,
    });

    // ❌ REJECT: eBay policy violation
    if (!groundingResult.compliance.isEbayCompliant) {
      logger.warn("Product rejected: eBay policy violation", {
        correlationId,
        violationCategory: groundingResult.compliance.violationCategory,
        reason: groundingResult.compliance.reason,
      });

      return {
        success: false,
        rejected: true,
        reason: "EBAY_POLICY_VIOLATION",
        details: groundingResult,
        metadata: {
          correlationId,
          processingTime: Date.now() - startTime,
        },
      };
    }

    // ⚠️ REQUIRE REVIEW: Low confidence or restricted
    if (groundingResult.recommendations.reviewNeeded) {
      logger.info("Product requires manual review", {
        correlationId,
        guidance: groundingResult.recommendations.guidance,
      });

      return {
        success: false,
        rejected: false,
        requiresReview: true,
        reason: "MANUAL_REVIEW_REQUIRED",
        details: groundingResult,
        metadata: {
          correlationId,
          processingTime: Date.now() - startTime,
        },
      };
    }

    // =========================================================================
    // PHASE 2: Physical Attributes - Weight, Dimensions, Condition
    // =========================================================================
    logger.info("Starting Phase 2: Physical Attributes", { correlationId });

    const physicalAttributes = await this._retryWithBackoff(
      () =>
        this.aiAgentic.extractPhysicalAttributes(
          selectedBuffers,
          groundingResult.productIdentification,
          correlationId
        ),
      "extractPhysicalAttributes",
      correlationId
    );

    logger.info("Phase 2 complete", {
      correlationId,
      weight: physicalAttributes.weight?.estimatedLbs,
      condition: physicalAttributes.condition?.grade,
    });

    // =========================================================================
    // PHASE 3: Pricing Strategy & Shipping
    // =========================================================================
    logger.info("Starting Phase 3: Pricing Strategy", { correlationId });

    const pricingStrategy = await this._retryWithBackoff(
      () =>
        this.aiAgentic.analyzePricingStrategy(
          groundingResult.productIdentification,
          physicalAttributes,
          options.marketData || [],
          options.sellerConfig || {},
          correlationId
        ),
      "analyzePricingStrategy",
      correlationId
    );

    logger.info("Phase 3 complete", {
      correlationId,
      price: pricingStrategy.pricing?.suggestedPrice,
      format: pricingStrategy.pricing?.strategyRecommendation?.listingFormat,
    });

    // =========================================================================
    // PHASE 4: Listing Content - Title, Description, SEO
    // =========================================================================
    logger.info("Starting Phase 4: Listing Content", { correlationId });

    const listingContent = await this._retryWithBackoff(
      () =>
        this.aiAgentic.generateListingContent(
          groundingResult.productIdentification,
          physicalAttributes,
          pricingStrategy,
          correlationId
        ),
      "generateListingContent",
      correlationId
    );

    logger.info("Phase 4 complete", {
      correlationId,
      titleLength: listingContent.title?.length,
      keywordsCount: listingContent.seoOptimization?.primaryKeywords?.length,
    });

    // =========================================================================
    // FINAL ASSEMBLY - Map to exact payload structure
    // =========================================================================
    const processingTime = Date.now() - startTime;

    const finalPayload = this._mapToListingPayload(
      {
        productIdentification: groundingResult.productIdentification,
        title: listingContent.title,
        subtitle: listingContent.subtitle,
        description: listingContent.description,
        condition: physicalAttributes.condition,
        weight: physicalAttributes.weight,
        dimensions: physicalAttributes.dimensions,
        pricing: pricingStrategy.pricing,
        shipping: pricingStrategy.shipping,
        itemSpecifics: listingContent.itemSpecifics,
        seoOptimization: listingContent.seoOptimization,
        listingRecommendations: listingContent.listingRecommendations,
        qualityChecks: physicalAttributes.qualityChecks,
        complianceFlags: listingContent.complianceFlags,
      },
      { processingTime }
    );

    logger.info("Multi-image analysis complete", {
      correlationId,
      processingTime,
      brand: finalPayload.productIdentification.brand,
      category: finalPayload.productIdentification.category,
      price: finalPayload.pricing.suggestedPrice,
    });

    return finalPayload;
  }

  // ===========================================================================
  // PAYLOAD MAPPING (Exact structure from your spec)
  // ===========================================================================

  _mapToListingPayload(data, options = {}) {
    const productId = data.productIdentification || {};
    const condition = data.condition || {};
    const pricing = data.pricing || {};
    const shipping = data.shipping || {};
    const weight = data.weight || {};
    const dimensions = data.dimensions || {};
    const seo = data.seoOptimization || {};
    const recommendations = data.listingRecommendations || {};
    const quality = data.qualityChecks || {};
    const compliance = data.complianceFlags || {};
    const disclaimers = data.legalDisclaimers || {};

    return {
      // Product Identification
      productIdentification: {
        brand: productId.brand || "Unbranded",
        model: productId.model || "Unknown",
        category: productId.category || data.category || "Other",
        upc: productId.upc || null,
        mpn: productId.mpn || null,
      },

      // Basic Listing Info
      title: data.title || "Untitled Item",
      subtitle: data.subtitle || null,

      // Description
      description: {
        plainText:
          data.description?.plainText ||
          data.description ||
          "No description available",
        structure: data.description?.structure || null,
      },

      // Condition Assessment
      condition: {
        grade: condition.grade || "Used",
        numericScore: condition.numericScore || null,
        description: condition.description || null,
        flaws: condition.flaws || [],
        userOverride: condition.userOverride || null,
      },

      // Weight & Dimensions (MANDATORY per spec)
      weight: {
        estimatedLbs: weight.estimatedLbs || 0,
        estimatedOz: weight.estimatedOz || 0,
        estimatedKg: weight.estimatedKg || 0,
        confidenceLevel: weight.confidenceLevel || "low",
        requiresManualVerification: weight.requiresManualVerification ?? true,
        rationale: weight.rationale || "Weight estimation unavailable",
      },

      dimensions: {
        length: dimensions.length || null,
        width: dimensions.width || null,
        height: dimensions.height || null,
        unit: dimensions.unit || "inches",
        confidenceLevel: dimensions.confidenceLevel || "low",
      },

      // Pricing Intelligence
      pricing: {
        suggestedPrice: this._parseFloat(pricing.suggestedPrice, 0),
        priceRange: {
          min: this._parseFloat(pricing.priceRange?.min, 0),
          max: this._parseFloat(pricing.priceRange?.max, 0),
        },
        currency: pricing.currency || "USD",
        confidenceScore: pricing.confidenceScore || 0.5,
        rationale: pricing.rationale || null,
        marketAnalysis: pricing.marketAnalysis || {
          soldListingsAnalyzed: 0,
          averageSoldPrice: null,
          priceDistribution: "No market data available",
          competitivePosition: "Unknown",
        },
        strategyRecommendation: {
          listingFormat:
            pricing.strategyRecommendation?.listingFormat || "Fixed Price",
          auctionStartPrice: this._parseFloat(
            pricing.strategyRecommendation?.auctionStartPrice,
            null
          ),
          bestOfferEnabled:
            pricing.strategyRecommendation?.bestOfferEnabled ?? true,
          bestOfferAutoAccept: this._parseFloat(
            pricing.strategyRecommendation?.bestOfferAutoAccept,
            null
          ),
          bestOfferAutoDecline: this._parseFloat(
            pricing.strategyRecommendation?.bestOfferAutoDecline,
            null
          ),
          shippingStrategy:
            pricing.strategyRecommendation?.shippingStrategy || "Buyer Pays",
          reasoning:
            pricing.strategyRecommendation?.reasoning || "Default strategy",
        },
      },

      // Shipping Optimization
      shipping: {
        recommendedService:
          shipping.recommendedService ||
          shipping.service ||
          "USPS Priority Mail",
        estimatedCost: this._parseFloat(shipping.estimatedCost, 0),
        handlingTime: shipping.handlingTime || "1 business day",
        packageType: shipping.packageType || "Box",
        requiresSignature: shipping.requiresSignature ?? false,
        fragile: shipping.fragile ?? false,
        sellerTemplateMatch: shipping.sellerTemplateMatch || null,
      },

      // Item Specifics
      itemSpecifics: data.itemSpecifics || {},

      // SEO Optimization
      seoOptimization: {
        primaryKeywords: seo.primaryKeywords || data.seoKeywords || [],
        secondaryKeywords: seo.secondaryKeywords || [],
        longtailKeywords: seo.longtailKeywords || [],
        competitorKeywords: seo.competitorKeywords || [],
        searchVolume: seo.searchVolume || null,
      },

      // Listing Recommendations
      listingRecommendations: {
        bestOfferEnabled: recommendations.bestOfferEnabled ?? true,
        internationalShipping: recommendations.internationalShipping ?? false,
        returnsAccepted: recommendations.returnsAccepted ?? true,
        returnPeriod: recommendations.returnPeriod || "30 days",
        returnShippingPaidBy: recommendations.returnShippingPaidBy || "Buyer",
        promotedListings: recommendations.promotedListings || {
          recommended: false,
          suggestedAdRate: "5%",
          reasoning: null,
        },
      },

      // Quality Checks
      qualityChecks: {
        imageQuality: quality.imageQuality || "unknown",
        imageQualityNotes: quality.imageQualityNotes || null,
        informationCompleteness: quality.informationCompleteness || 0.5,
        missingInformation: quality.missingInformation || [],
        recommendedAdditionalPhotos: quality.recommendedAdditionalPhotos || [],
      },

      // Compliance Flags
      complianceFlags: {
        brandAuthenticity: compliance.brandAuthenticity || "uncertain",
        prohibitedItems: compliance.prohibitedItems ?? false,
        restrictedCategories: compliance.restrictedCategories ?? false,
        requiresAdditionalDisclosures:
          compliance.requiresAdditionalDisclosures ?? false,
        warnings: compliance.warnings || [],
      },

      // Legal Disclaimers (MANDATORY per spec)
      legalDisclaimers: {
        pricing:
          disclaimers.pricing ||
          "AI-suggested prices are estimates based on market analysis. Seller is solely responsible for final pricing decisions. Actual market value may vary.",
        condition:
          disclaimers.condition ||
          "AI condition assessment is preliminary. Seller must verify and accurately represent item condition in final listing.",
        accuracy:
          disclaimers.accuracy ||
          "All AI-generated content is advisory. Seller is responsible for ensuring listing accuracy and compliance with eBay policies.",
        liability:
          disclaimers.liability ||
          "AI suggestions do not guarantee sales performance or listing acceptance by eBay.",
      },

      // Metadata
      metadata: {
        generatedAt: new Date().toISOString(),
        modelVersion: this.modelName,
        processingTime: options.processingTime || null,
      },
    };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  async _retryWithBackoff(fn, name, correlationId) {
    let attempt = 0;
    let delay = this.initialDelayMs;

    while (attempt < this.maxRetries) {
      attempt++;

      logger.debug(`${name}: attempt ${attempt}/${this.maxRetries}`, {
        correlationId,
      });

      try {
        return await fn();
      } catch (err) {
        const isRetryable = this._isRetryableError(err);

        logger.warn(`${name}: attempt ${attempt} failed`, {
          correlationId,
          error: err.message,
          retryable: isRetryable,
        });

        if (!isRetryable || attempt >= this.maxRetries) {
          logger.error(`${name}: giving up after ${attempt} attempts`, {
            correlationId,
            error: err.message,
          });
          throw err;
        }

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  _isRetryableError(err) {
    const msg = err?.message?.toLowerCase() || "";
    return (
      msg.includes("timeout") ||
      msg.includes("rate") ||
      msg.includes("overload") ||
      msg.includes("503") ||
      msg.includes("429") ||
      msg.includes("quota") ||
      msg.includes("invalid json") ||
      msg.includes("json parse")
    );
  }

  _validateImage(base64, mimeType = "image/jpeg") {
    if (!base64) {
      throw new Error("Missing base64 image data");
    }

    if (!this.ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error(`Unsupported mime type: ${mimeType}`);
    }

    const sizeMB = Buffer.byteLength(base64, "base64") / (1024 * 1024);

    if (sizeMB > this.MAX_IMAGE_SIZE_MB) {
      throw new Error(
        `Image too large: ${sizeMB.toFixed(2)}MB (max: ${
          this.MAX_IMAGE_SIZE_MB
        }MB)`
      );
    }
  }

  _parseFloat(value, defaultValue) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  _correlationId() {
    return `gemini-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
}

module.exports = new GeminiService();
