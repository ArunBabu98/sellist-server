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

    this.tokenUsage = {
      total: 0,
      byOperation: {},
    };
  }

  // ✅ FIX: Getter for lazy loading
  get aiAgentic() {
    if (!this._aiAgentic) {
      // this._aiAgentic = require("./ai.agentic");
      this._aiAgentic = require("./ai.agentic");
    }
    return this._aiAgentic;
  }
  _logTokenUsage(operationName, response, correlationId) {
    try {
      const usage = response?.usageMetadata;

      if (!usage) {
        logger.warn("No token usage metadata available", {
          correlationId,
          operation: operationName,
        });
        return null;
      }

      const tokenData = {
        promptTokens: usage.promptTokenCount || 0,
        candidatesTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
        cachedContentTokens: usage.cachedContentTokenCount || 0,
      };

      // Update totals
      this.tokenUsage.total += tokenData.totalTokens;

      if (!this.tokenUsage.byOperation[operationName]) {
        this.tokenUsage.byOperation[operationName] = {
          calls: 0,
          totalTokens: 0,
          promptTokens: 0,
          candidatesTokens: 0,
        };
      }

      this.tokenUsage.byOperation[operationName].calls += 1;
      this.tokenUsage.byOperation[operationName].totalTokens +=
        tokenData.totalTokens;
      this.tokenUsage.byOperation[operationName].promptTokens +=
        tokenData.promptTokens;
      this.tokenUsage.byOperation[operationName].candidatesTokens +=
        tokenData.candidatesTokens;

      logger.info("Gemini API token usage", {
        correlationId,
        operation: operationName,
        model: this.modelName,
        tokens: tokenData,
        costEstimate: this._estimateCost(tokenData),
      });

      return tokenData;
    } catch (err) {
      logger.error("Failed to log token usage", {
        correlationId,
        operation: operationName,
        error: err.message,
      });
      return null;
    }
  }

  // ✅ NEW: Estimate cost based on token usage
  _estimateCost(tokenData) {
    // Gemini 2.5 Flash pricing (as of Jan 2026)
    // Input: $0.00001875 per 1K tokens
    // Output: $0.000075 per 1K tokens
    // Cached: $0.000001875 per 1K tokens (90% discount)

    const inputCost = (tokenData.promptTokens / 1000) * 0.00001875;
    const outputCost = (tokenData.candidatesTokens / 1000) * 0.000075;
    const cachedCost = (tokenData.cachedContentTokens / 1000) * 0.000001875;

    const total = inputCost + outputCost + cachedCost;

    return {
      input: `$${inputCost.toFixed(6)}`,
      output: `$${outputCost.toFixed(6)}`,
      cached: `$${cachedCost.toFixed(6)}`,
      total: `$${total.toFixed(6)}`,
    };
  }

  // ✅ NEW: Get aggregated token usage stats
  getTokenUsageStats() {
    return {
      totalTokensUsed: this.tokenUsage.total,
      operationBreakdown: this.tokenUsage.byOperation,
      estimatedTotalCost: this._estimateTotalCost(),
    };
  }

  _estimateTotalCost() {
    let totalCost = 0;

    Object.values(this.tokenUsage.byOperation).forEach((op) => {
      // Rough estimate assuming 80/20 input/output split
      const inputTokens = op.promptTokens;
      const outputTokens = op.candidatesTokens;

      totalCost += (inputTokens / 1000) * 0.00001875;
      totalCost += (outputTokens / 1000) * 0.000075;
    });

    return `$${totalCost.toFixed(6)}`;
  }

  // ✅ NEW: Reset token usage stats (useful for testing)
  resetTokenUsage() {
    this.tokenUsage = {
      total: 0,
      byOperation: {},
    };
    logger.info("Token usage stats reset");
  }

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
        `Too many images. Maximum ${this.MAX_IMAGES_PER_REQUEST} allowed`,
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

    // Single high-level agentic call (2 internal Gemini calls)
    const listingPayload = await this._retryWithBackoff(
      () =>
        this.aiAgentic.generateCompleteListing(
          buffers,
          {
            marketData: options.marketData || [],
            sellerConfig: options.sellerConfig || {},
            userProvidedCondition: options.userProvidedCondition || null,
          },
          correlationId,
        ),
      "generateCompleteListing",
      correlationId,
    );

    // If agentic flow decided to reject / require review, just return that object
    if (listingPayload.rejected || listingPayload.requiresReview) {
      logger.info("Multi-image analysis completed with non-success state", {
        correlationId,
        rejected: !!listingPayload.rejected,
        requiresReview: !!listingPayload.requiresReview,
        reason: listingPayload.reason,
        processingTime: listingPayload.metadata?.processingTime,
      });
      return listingPayload;
    }

    // Ensure processingTime is set if not already
    const processingTime =
      listingPayload.metadata?.processingTime ?? Date.now() - startTime;

    listingPayload.metadata = {
      ...(listingPayload.metadata || {}),
      correlationId,
      processingTime,
    };

    logger.info("Multi-image analysis complete", {
      correlationId,
      processingTime,
      brand: listingPayload.productIdentification?.brand,
      category: listingPayload.productIdentification?.category,
      categoryId: listingPayload.productIdentification?.categoryId, // ✅ Fixed
      validConditions: listingPayload.metadata?.categoryConditions, // ✅ Fixed
      price: listingPayload.pricing?.suggestedPrice,
    });

    return listingPayload;
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
            null,
          ),
          bestOfferEnabled:
            pricing.strategyRecommendation?.bestOfferEnabled ?? true,
          bestOfferAutoAccept: this._parseFloat(
            pricing.strategyRecommendation?.bestOfferAutoAccept,
            null,
          ),
          bestOfferAutoDecline: this._parseFloat(
            pricing.strategyRecommendation?.bestOfferAutoDecline,
            null,
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
        }MB)`,
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
