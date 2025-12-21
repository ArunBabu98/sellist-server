// services/ai.agentic.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../../../config/logger.config");
const config = require("../../../config");
const { QUALITY_SYSTEM, QUALITY_USER } = require("../prompts/visualID.prompt");
const {
  GROUNDING_SYSTEM,
  GROUNDING_USER,
} = require("../prompts/grounding.prompt");

class AIAgentic {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    this.filterModel = "gemini-2.5-flash"; // Vision + high-accuracy extraction
    this.reasoningModel = "gemini-2.5-flash"; // Text-only reasoning/listing
  }

  // ===========================================================================
  // PUBLIC HIGH-LEVEL API
  // ===========================================================================

  /**
   * NEW: Full pipeline using 2 calls:
   *  1) Visual snapshot (high visual accuracy, no pricing)
   *  2) Listing generation from snapshot + market/seller context
   *
   * @param {Array<{buffer: Buffer, mimeType: string, index?: number}>} buffers
   * @param {Object} options { marketData, sellerConfig, userProvidedCondition }
   * @param {string|null} correlationId
   * @returns {Promise<Object>} listing payload in full _mapToListingPayload shape
   */
  async generateCompleteListing(buffers, options = {}, correlationId = null) {
    const startTime = Date.now();
    const cid = correlationId || `ai-agentic-${Date.now()}`;

    logger.info("AIAgentic - generateCompleteListing: start", {
      correlationId: cid,
      imageCount: buffers.length,
    });

    // 1) Visual snapshot (vision-heavy, accurate)
    const visualSnapshot = await this.generateVisualSnapshot(buffers, cid);

    // Early compliance rejection / manual review
    if (!visualSnapshot.compliance.isEbayCompliant) {
      logger.warn("AIAgentic - compliance rejected", {
        correlationId: cid,
      });

      return {
        success: false,
        rejected: true,
        reason: "EBAY_POLICY_VIOLATION",
        details: visualSnapshot,
        metadata: {
          correlationId: cid,
          code: code,
          processingTime: Date.now() - startTime,
        },
      };
    }

    // 2) Listing generation from snapshot + context
    const {
      marketData = [],
      sellerConfig = {},
      userProvidedCondition = null,
    } = options;

    const listingCore = await this.generateListingFromSnapshot(
      visualSnapshot,
      {
        marketData,
        sellerConfig,
        userProvidedCondition,
      },
      cid
    );

    const processingTime = Date.now() - startTime;

    // listingCore is already shaped like _mapToListingPayload,
    // but we also inject/override metadata to match client expectations
    const finalPayload = {
      ...listingCore,
      metadata: {
        ...(listingCore.metadata || {}),
        correlationId: cid,
        processingTime,
      },
    };

    logger.info("AIAgentic - generateCompleteListing: success", {
      correlationId: cid,
      brand: finalPayload.productIdentification?.brand,
      category: finalPayload.productIdentification?.category,
      price: finalPayload.pricing?.suggestedPrice,
      processingTime,
    });

    return finalPayload;
  }

  // ===========================================================================
  // STEP 1: VISUAL SNAPSHOT (HIGH VISUAL ACCURACY)
  // Combines: image quality, grounding, physical attributes, basic compliance
  // ===========================================================================

  /**
   * Generate a high-accuracy visual snapshot of the product.
   * This is the only vision-heavy call.
   *
   * @param {Array<{buffer: Buffer, mimeType: string, index?: number}>} buffers
   * @param {string|null} correlationId
   * @returns {Promise<Object>} visual snapshot JSON
   *
   * Shape:
   * {
   *   productIdentification: { brand, model, category, upc, mpn, confidence },
   *   condition: { grade, numericScore, description, flaws, userOverride },
   *   weight: {...},
   *   dimensions: {...},
   *   compliance: {...},
   *   recommendations: {...},
   *   rawVisualNotes: {...}
   * }
   */
  async generateVisualSnapshot(buffers, correlationId = null) {
    const cid = correlationId || `ai-visual-${Date.now()}`;
    logger.info("AIAgentic - Visual Snapshot", {
      correlationId: cid,
      imageCount: buffers.length,
    });

    const model = this.genAI.getGenerativeModel({
      model: this.filterModel,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2, // ✅ Lower for more deterministic brand detection
        responseMimeType: "application/json",
      },
    });

    const prompt = `
You are an expert eBay product identifier with deep knowledge of brands, logos, packaging, and product markings.

CRITICAL TASK: Identify the product from images with MAXIMUM ACCURACY.

BRAND IDENTIFICATION PRIORITY (in order):
1. **Visible logos** - Check all angles for brand logos, emblems, tags
2. **Text on product** - Brand names printed, engraved, or stamped on item
3. **Packaging** - Boxes, bags, tags with brand names
4. **Product design** - Distinctive shapes, colors, patterns associated with specific brands
5. **Licensing marks** - "©", "®", "™" followed by company names
6. **Model numbers** - Often contain brand prefixes

IMPORTANT RULES FOR BRAND:
- If you see ANY brand indicator (logo, text, design), identify it
- Common toy brands: My Little Pony, Hasbro, Mattel, LEGO, Disney, etc.
- For toys/collectibles: Check for character names that imply brand (e.g., "Sparkleworks" = My Little Pony character)
- If product has distinctive licensed character, infer brand from franchise
- Only use "Unbranded" if genuinely generic with NO identifiable marks
- If uncertain between 2 brands, choose the one with stronger visual evidence

MODEL IDENTIFICATION:
- Look for specific product names, series names, character names
- Check for model numbers, SKUs, or edition names
- For characters: Use character name as model (e.g., "Sparkleworks", "Rainbow Dash")

CATEGORY:
- Use eBay-style category paths (e.g., "Toys & Hobbies > TV & Movie Character Toys > My Little Pony")
- Be specific where possible

WEIGHT & DIMENSIONS:
- Estimate based on product type and visible size
- Add 15% to weight for packaging
- Reference guide:
 • Small toy figure: 3-6 oz
 • Action figure: 5-10 oz
 • Plush toy: 6-16 oz
 • Board game: 24-48 oz

CONDITION ASSESSMENT:
- Grade: "New|Like New|Very Good|Good|Acceptable|For parts or not working"
- List ALL visible flaws honestly

OUTPUT STRICT JSON (NO MARKDOWN):

{
  "productIdentification": {
    "brand": "IDENTIFIED BRAND or 'Unbranded'",
    "model": "Character/model name or null",
    "category": "eBay category path",
    "upc": "string or null",
    "mpn": "string or null",
    "confidence": 0-1
  },
  "condition": {
    "grade": "New|Like New|Very Good|Good|Acceptable|For parts or not working",
    "flaws": ["short phrase"],
  },
  "weight": {
    "value": number,
    "unit": "oz",
    "confidence": "high|medium|low"
  },
  "dimensions": {
    "length": number,
    "width": number,
    "height": number,
    "unit": "inches",
    "confidenceLevel": "high|medium|low"
  },
  "compliance": {
    "isEbayCompliant": boolean,
    "code": "string|null"
  },
  "rawVisualNotes": {
    "visibleText": ["all visible text on product/packaging"],
    "logoHints": ["observed logos, symbols, brand marks"],
    "possibleSubcategories": ["specific product type hints"]
  }
}

EXAMPLES OF GOOD BRAND IDENTIFICATION:
- Pink pony toy with purple hair and sparkle cutie mark → Brand: "My Little Pony", Model: "Sparkleworks"
- Blue hedgehog with red shoes → Brand: "Sega", Model: "Sonic the Hedgehog"
- Yellow electric mouse with red cheeks → Brand: "Nintendo", Model: "Pikachu"
- Building blocks with circular studs → Brand: "LEGO"

ANALYZE THE IMAGES NOW AND IDENTIFY THE PRODUCT:
`;

    const parts = [{ text: prompt }];
    for (const img of buffers) {
      parts.push({
        inlineData: {
          data: img.buffer.toString("base64"),
          mimeType: img.mimeType,
        },
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from generateVisualSnapshot");
    }

    logger.debug("Visual Snapshot raw response length", {
      correlationId: cid,
      responseLength: text?.length,
    });

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, cid);

    logger.info("AIAgentic - Visual Snapshot complete", {
      correlationId: cid,
      brand: parsed.productIdentification?.brand,
      model: parsed.productIdentification?.model,
      category: parsed.productIdentification?.category,
      confidence: parsed.productIdentification?.confidence,
      compliant: parsed.compliance?.isEbayCompliant,
    });

    return parsed;
  }

  // ===========================================================================
  // STEP 2: LISTING FROM SNAPSHOT (TEXT-ONLY REASONING)
  // Generates full listing structure compatible with _mapToListingPayload.
  // ===========================================================================

  /**
   * Generate full listing payload from a visualSnapshot + context.
   *
   * @param {Object} visualSnapshot - output of generateVisualSnapshot
   * @param {Object} options { marketData, sellerConfig, userProvidedCondition }
   * @param {string|null} correlationId
   * @returns {Promise<Object>} listing payload in _mapToListingPayload shape
   */
  async generateListingFromSnapshot(
    visualSnapshot,
    options = {},
    correlationId = null
  ) {
    const cid = correlationId || `ai-listing-${Date.now()}`;
    logger.info("AIAgentic - Listing from snapshot", { correlationId: cid });

    const { marketData = [] } = options;

    const productId = visualSnapshot.productIdentification || {};
    const condition = visualSnapshot.condition || {};
    const weight = visualSnapshot.weight || {};
    const dimensions = visualSnapshot.dimensions || {};
    const visualNotes = visualSnapshot.rawVisualNotes || {};

    const model = this.genAI.getGenerativeModel({
      model: this.reasoningModel,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.35,
        responseMimeType: "application/json",
      },
    });

    const brand = productId.brand || "Unbranded";
    const modelName = productId.model || "Unknown";
    const category = productId.category || "Other";

    const prompt = `
You are an expert eBay listing creator.

INPUT:
- Visual snapshot (already extracted from images)
- Market data (sold listings)
- Seller config (shipping, returns, etc.)

GOAL:
Generate a COMPLETE listing JSON that matches this schema (NO markdown):

{
  "productIdentification": {
    "brand": "string",
    "model": "string",
    "category": "string",
    "upc": "string|null",
    "mpn": "string|null"
  },
  "title": "SEO-optimized title (<=80 chars)",
  "subtitle": "string|null",
  "description": {
    "plainText": "<=180 words, factual, buyer-focused",
    "structure": {
      "hook": "1-2 concise sentences",
      "condition": "1 sentence, honest",
      "keyFeatures": ["short bullet"],
      "specs": ["key: value"],
      "included": ["item list"],
      "sellerNote": "1 short trust sentence"
    }
  }
  },
  "condition": {
    "grade": "New|Like New|Very Good|Good|Acceptable|For parts or not working",
    "flaws": ["short phrase"],
  },
  "weight": {
    "value": number,
    "unit": "oz",
    "confidence": "high|medium|low"
  },
  "dimensions": {
    "length": number|null,
    "width": number|null,
    "height": number|null,
    "unit": "inches",
    "confidenceLevel": "high|medium|low"
  },
  "pricing": {
    "suggestedPrice": number,
    "priceRange": { "min": number, "max": number },
    "currency": "USD",
    "confidenceScore": 0-1,
    "rationale": "string",
    "marketAnalysis": {
      "soldListingsAnalyzed": number,
      "averageSoldPrice": number|null,
      "priceDistribution": "string",
      "competitivePosition": "string"
    },
    "strategyRecommendation": {
      "listingFormat": "Fixed Price|Auction|Both",
      "auctionStartPrice": number|null,
      "bestOfferEnabled": boolean,
      "bestOfferAutoAccept": number|null,
      "bestOfferAutoDecline": number|null,
      "shippingStrategy": "Buyer Pays|Free Shipping|Calculated",
      "reasoning": "string"
    }
  },
  "shipping": {
    "recommendedService": "string",
    "estimatedCost": number,
    "handlingTime": "string",
    "packageType": "string",
    "requiresSignature": boolean,
    "fragile": boolean,
    "sellerTemplateMatch": "string|null"
  },
  "itemSpecifics": {
    "Brand": "string",
    "Model": "string",
    "Condition": "string",
    "Type": "string|null",
    "Color": "string|null",
    "Material": "string|null",
    "Character": "string|null",
    "Year": "string|null"
  },
  "seo": {
    "keywords": ["short phrase"]
  },
  "listingRecommendations": {
    "bestOfferEnabled": boolean,
    "internationalShipping": boolean,
    "returnsAccepted": boolean,
    "returnPeriod": "string",
    "returnShippingPaidBy": "Buyer|Seller",
    "promotedListings": {
      "recommended": boolean,
      "suggestedAdRate": "string",
      "reasoning": "string"
    }
  },
}

USE THESE VISUAL VALUES AS GROUND TRUTH (do not contradict them):

Visual snapshot:
${JSON.stringify(visualSnapshot, null, 2)}

RULES:
- Brand, Model, Category must come from productIdentification above.
- Keep description <= 400 words.
- Price using comparable similar eBay listings.
- NEVER output markdown, ONLY a single valid JSON object.
- NEVER return multiple JSON objects or arrays. Only ONE object with the exact keys shown above.
- DO NOT leave any array empty. If you would leave it empty, instead add at least one best-guess element.
- DO NOT invent new top-level keys or remove any of the required ones.
`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from generateListingFromSnapshot");
    }

    logger.debug("Listing from snapshot raw response", {
      correlationId: cid,
      responseLength: text?.length,
      preview: text.slice(0, 200),
    });

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, cid);

    // Post-process itemSpecifics: ensure Brand/Model/Condition filled
    if (parsed.itemSpecifics) {
      // Fix fallbacks FIRST (before cleanup)
      if (
        !parsed.itemSpecifics.Brand ||
        parsed.itemSpecifics.Brand === "string"
      ) {
        parsed.itemSpecifics.Brand = brand;
      }
      if (
        !parsed.itemSpecifics.Model ||
        parsed.itemSpecifics.Model === "string"
      ) {
        parsed.itemSpecifics.Model = modelName;
      }
      if (
        !parsed.itemSpecifics.Condition ||
        parsed.itemSpecifics.Condition === "string"
      ) {
        parsed.itemSpecifics.Condition = condition.grade || "Used";
      }

      // THEN clean invalid values (only after fallbacks)
      Object.keys(parsed.itemSpecifics).forEach((key) => {
        const value = parsed.itemSpecifics[key];
        if (
          value === null ||
          value === "null" ||
          value === "string" ||
          value === "" ||
          value === undefined
        ) {
          delete parsed.itemSpecifics[key];
        }
      });

      // Safety: Ensure minimum required fields exist
      if (Object.keys(parsed.itemSpecifics).length === 0) {
        parsed.itemSpecifics = {
          Brand: brand,
          Model: modelName,
          Condition: condition.grade || "Used",
        };
      }
    }

    // Ensure essential blocks exist and fallback to visual snapshot where needed
    parsed.productIdentification = parsed.productIdentification || {
      brand,
      model: modelName,
      category,
      upc: productId.upc || null,
      mpn: productId.mpn || null,
    };

    parsed.condition = parsed.condition || {
      flaws: condition.flaws || [],
    };

    parsed.weight = parsed.weight || weight;
    parsed.dimensions = parsed.dimensions || dimensions;

    logger.info("AIAgentic - Listing from snapshot complete", {
      correlationId: cid,
      titleLength: parsed.title?.length,
      keywordsCount: parsed.seo?.keywords?.length,
    });

    return parsed;
  }

  // ===========================================================================
  // LEGACY PHASE METHODS (OPTIONAL)
  // Kept for backward compatibility if you still call them individually.
  // visualImageID, visualGrounding, extractPhysicalAttributes, analyzePricingStrategy,
  // generateListingContent can remain or be removed if unused.
  // ===========================================================================

  async visualImageID(buffers, correlationId = null) {
    logger.info("Phase 0 - Image Quality Check", {
      correlationId,
      imageCount: buffers.length,
    });

    const model = this.genAI.getGenerativeModel({
      model: this.filterModel,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.3,
      },
    });

    const parts = [{ text: QUALITY_SYSTEM }, { text: QUALITY_USER }];

    for (const img of buffers) {
      parts.push({
        inlineData: {
          data: img.buffer.toString("base64"),
          mimeType: img.mimeType,
        },
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from visualImageID");
    }

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, correlationId);

    logger.info("Phase 0 complete", {
      correlationId,
      usableImages: parsed.summary.usableImages,
    });

    return parsed;
  }

  async visualGrounding(buffers, correlationId = null) {
    logger.info("Phase 1 - Visual Grounding", {
      correlationId,
      imageCount: buffers.length,
    });

    const model = this.genAI.getGenerativeModel({
      model: this.filterModel,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const parts = [{ text: GROUNDING_SYSTEM }, { text: GROUNDING_USER }];

    for (const img of buffers) {
      parts.push({
        inlineData: {
          data: img.buffer.toString("base64"),
          mimeType: img.mimeType,
        },
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from visualGrounding");
    }

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, correlationId);

    logger.info("Phase 1 complete", {
      correlationId,
      compliant: parsed.compliance.isEbayCompliant,
      confidence: parsed.productIdentification.confidence,
    });

    return parsed;
  }

  // (You can keep extractPhysicalAttributes, analyzePricingStrategy,
  //  generateListingContent as-is if other callers still use them.)

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  _cleanJson(text) {
    if (!text || typeof text !== "string") return "";

    let cleaned = text.trim();

    // Remove markdown fences
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    cleaned = cleaned.replace(/```/g, "");
    cleaned = cleaned.trim();

    // Extract JSON object boundaries
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1) {
      logger.warn("Attempting JSON recovery (truncated response detected)");
      cleaned = cleaned.substring(firstBrace);
      cleaned = this._attemptJsonRecovery(cleaned);
    } else {
      throw new Error("No JSON object found in AI response");
    }

    return cleaned.trim();
  }

  _attemptJsonRecovery(truncatedJson) {
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < truncatedJson.length; i++) {
      const char = truncatedJson[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"' && !escaped) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") braceCount++;
        else if (char === "}") braceCount--;
        else if (char === "[") bracketCount++;
        else if (char === "]") bracketCount--;
      }
    }

    if (inString) {
      truncatedJson += '"';
    }

    while (bracketCount > 0) {
      truncatedJson += "]";
      bracketCount--;
    }

    while (braceCount > 0) {
      truncatedJson += "}";
      braceCount--;
    }

    return truncatedJson;
  }

  _parseJson(text, correlationId) {
    try {
      return JSON.parse(text);
    } catch (err) {
      logger.error("JSON parse failed", {
        correlationId,
        preview: text.slice(0, 500),
      });
      throw new Error("Invalid JSON from AI");
    }
  }
}

module.exports = new AIAgentic();
