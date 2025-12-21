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
    this.filterModel = "gemini-2.5-flash"; // Cheap for filters
    this.reasoningModel = "gemini-2.5-flash"; // Better for analysis
  }

  // ===========================================================================
  // PHASE 0: Image Quality & Role Assignment
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
    this._validateSchema(parsed, ["images", "summary"]);

    logger.info("Phase 0 complete", {
      correlationId,
      usableImages: parsed.summary.usableImages,
    });

    return parsed;
  }

  // ===========================================================================
  // PHASE 1: Visual Grounding - Product ID + Compliance
  // ===========================================================================
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
    this._validateSchema(parsed, ["productIdentification", "compliance"]);

    logger.info("Phase 1 complete", {
      correlationId,
      compliant: parsed.compliance.isEbayCompliant,
      confidence: parsed.productIdentification.confidence,
    });

    return parsed;
  }

  // ===========================================================================
  // PHASE 2: Physical Attributes - Weight, Dimensions, Condition
  // ===========================================================================
  // services/ai.agentic.js - Update extractPhysicalAttributes method

  async extractPhysicalAttributes(buffers, productContext, correlationId) {
    logger.info("Phase 2 - Physical Attributes", { correlationId });

    const model = this.genAI.getGenerativeModel({
      model: this.filterModel,
      // ✅ ADD: Generation config to ensure complete responses
      generationConfig: {
        maxOutputTokens: 2048, // Increased from default
        temperature: 0.4, // Lower for more deterministic output
      },
    });

    const prompt = `
Product: ${productContext.category || "Unknown"} | ${
      productContext.brand || "Unknown"
    } | ${productContext.model || "Unknown"}

Extract physical attributes. Keep rationale strings under 100 characters.

1. WEIGHT (REQUIRED):
   - Category: ${productContext.category}
   - Estimate based on visible size + materials
   - Add 15% for packaging
   - Reference guide:
     * Smartphone: 0.3-0.5 lbs
     * Shoes (men): 1.5-2.5 lbs
     * Laptop: 3-6 lbs
     * T-shirt: 0.3-0.5 lbs
     * Book: 0.5-2 lbs
     * Toy figures: 0.2-0.4 lbs

2. DIMENSIONS:
   - Estimate packaging size
   - Use visible reference objects

3. CONDITION:
   - 10-point scale (10=perfect, 1=parts only)
   - List ALL flaws
   - Grades: New(10), Like New(9-9.5), Very Good(8-8.5), Good(7-7.5), Acceptable(6-6.5), For Parts(1-3)

IMPORTANT: Keep all text fields concise. Rationale must be under 100 characters.

JSON:
{
  "weight": {
    "estimatedLbs": number,
    "estimatedOz": number,
    "estimatedKg": number,
    "confidenceLevel": "high|medium|low",
    "requiresManualVerification": boolean,
    "rationale": "string (max 100 chars)"
  },
  "dimensions": {
    "length": number,
    "width": number,
    "height": number,
    "unit": "inches",
    "confidenceLevel": "high|medium|low"
  },
  "condition": {
    "grade": "New|Like New|Very Good|Good|Acceptable|For parts or not working",
    "numericScore": number,
    "description": "string (max 200 chars)",
    "flaws": ["string"]
  },
  "qualityChecks": {
    "imageQuality": "excellent|good|acceptable|poor",
    "imageQualityNotes": "string (max 150 chars)",
    "informationCompleteness": 0-1,
    "missingInformation": ["string"],
    "recommendedAdditionalPhotos": ["string"]
  }
}
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

    // ✅ Log full response for debugging
    logger.debug("Phase 2 raw response length", {
      correlationId,
      responseLength: text?.length,
    });

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, correlationId);

    logger.info("Phase 2 complete", {
      correlationId,
      weight: parsed.weight?.estimatedLbs,
      condition: parsed.condition?.grade,
    });

    return parsed;
  }

  // ===========================================================================
  // PHASE 3: Pricing Strategy & Shipping
  // ===========================================================================

  async analyzePricingStrategy(
    productContext,
    physicalAttributes,
    marketData,
    sellerConfig,
    correlationId
  ) {
    logger.info("Phase 3 - Pricing Strategy", { correlationId });

    const model = this.genAI.getGenerativeModel({
      model: this.reasoningModel,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const marketDataStr =
      marketData && marketData.length > 0
        ? `Sold listings (${marketData.length}):
${marketData
  .slice(0, 10)
  .map(
    (item) =>
      `- $${item.price} | ${item.condition} | ${item.title.substring(0, 50)}`
  )
  .join("\n")}`
        : "No market data";

    // ✅ SIMPLIFIED PROMPT - Much shorter, more direct
    const prompt = `
Product: ${productContext.category || "Unknown"} | ${
      productContext.brand || "Unknown"
    } | ${productContext.model || "Unknown"}
Condition: ${physicalAttributes.condition?.grade || "Unknown"} (${
      physicalAttributes.condition?.numericScore || "N/A"
    }/10)
Weight: ${physicalAttributes.weight?.estimatedLbs || 0} lbs

Market: ${marketDataStr}

Seller: ${sellerConfig?.shippingPreference || "Buyer pays"} shipping, ${
      sellerConfig?.returnsAccepted ? "30-day" : "No"
    } returns

Generate pricing JSON. ALL text fields max 50 chars.

{
  "pricing": {
    "suggestedPrice": number,
    "priceRange": {"min": number, "max": number},
    "currency": "USD",
    "confidenceScore": 0-1,
    "rationale": "brief (max 50 chars)",
    "marketAnalysis": {
      "soldListingsAnalyzed": ${marketData?.length || 0},
      "averageSoldPrice": null,
      "priceDistribution": "brief (max 50 chars)",
      "competitivePosition": "brief (max 50 chars)"
    },
    "strategyRecommendation": {
      "listingFormat": "Fixed Price",
      "auctionStartPrice": null,
      "bestOfferEnabled": true,
      "bestOfferAutoAccept": null,
      "bestOfferAutoDecline": null,
      "shippingStrategy": "Buyer Pays",
      "reasoning": "brief (max 50 chars)"
    }
  },
  "shipping": {
    "recommendedService": "USPS Priority Mail",
    "estimatedCost": number,
    "handlingTime": "1 business day",
    "packageType": "Box",
    "requiresSignature": false,
    "fragile": false,
    "sellerTemplateMatch": null
  }
}

Rules:
- Price based on condition: Good -15%
- Best Offer if price > $30
- Keep ALL strings under 50 characters
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // ✅ Log response for debugging
    logger.debug("Phase 3 raw response", {
      correlationId,
      responseLength: text?.length,
      preview: text.slice(0, 200),
    });

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, correlationId);

    logger.info("Phase 3 complete", {
      correlationId,
      price: parsed.pricing?.suggestedPrice,
      format: parsed.pricing?.strategyRecommendation?.listingFormat,
    });

    return parsed;
  }

  // ===========================================================================
  // PHASE 4: Listing Content - Title, Description, SEO
  // ===========================================================================

  async generateListingContent(
    productContext,
    physicalAttributes,
    pricingStrategy,
    correlationId
  ) {
    logger.info("Phase 4 - Listing Content", { correlationId });

    const model = this.genAI.getGenerativeModel({
      model: this.reasoningModel,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
        responseMimeType: "application/json",
      },
    });

    // ✅ Extract actual values to use
    const brand = productContext.brand || "Unbranded";
    const model_name = productContext.model || "N/A";
    const category = productContext.category || "Unknown";
    const condition = physicalAttributes.condition?.grade || "Used";

    const prompt = `
Generate eBay listing for this product:

PRODUCT DETAILS (use these exact values):
- Brand: ${brand}
- Model: ${model_name}
- Category: ${category}
- Condition: ${condition} (${
      physicalAttributes.condition?.numericScore || "N/A"
    }/10)
- Price: $${pricingStrategy.pricing?.suggestedPrice || 0}
- Weight: ${physicalAttributes.weight?.estimatedLbs || 0} lbs
- Flaws: ${physicalAttributes.condition?.flaws?.join(", ") || "None"}

Generate listing with description under 400 words.

JSON OUTPUT (use ACTUAL values from above, NOT placeholders):
{
  "title": "string (80 chars max) - Use: ${brand} ${model_name} [key feature] ${condition}",
  "subtitle": null,
  "description": {
    "plainText": "string (400 words max)",
    "structure": {
      "hook": "2-3 sentence opening",
      "conditionDetails": "Honest assessment",
      "keyFeatures": ["feature 1", "feature 2", "feature 3"],
      "specifications": "Technical details",
      "included": "What's in package",
      "whyBuyFromMe": "Shipping/returns/seller highlights"
    }
  },
  "seoOptimization": {
    "primaryKeywords": ["${brand.toLowerCase()}", "${category.toLowerCase()}", "${model_name.toLowerCase()}"],
    "secondaryKeywords": ["related keyword 1", "related keyword 2"],
    "longtailKeywords": ["long phrase 1", "long phrase 2"],
    "competitorKeywords": ["competitor keyword"],
    "searchVolume": "analysis string"
  },
  "itemSpecifics": {
    "Brand": "${brand}",
    "Model": "${model_name}",
    "Condition": "${condition}",
    "Type": "describe product type",
    "Color": "visible color or null",
    "Material": "material type or null",
    "Character": "character name if toy/collectible, else null",
    "Year": "year if visible, else null"
  },
  "listingRecommendations": {
    "bestOfferEnabled": true,
    "internationalShipping": false,
    "returnsAccepted": true,
    "returnPeriod": "30 days",
    "returnShippingPaidBy": "Buyer",
    "promotedListings": {
      "recommended": false,
      "suggestedAdRate": "5%",
      "reasoning": "brief reasoning"
    }
  },
  "complianceFlags": {
    "brandAuthenticity": "likely authentic",
    "prohibitedItems": false,
    "restrictedCategories": false,
    "requiresAdditionalDisclosures": false,
    "warnings": []
  }
}

CRITICAL RULES:
1. itemSpecifics MUST use actual values from product details above
2. Do NOT use "string" or null for Brand, Model, or Condition
3. Title format: ${brand} ${model_name} [Feature] ${condition}
4. Fill in Color, Material, Type based on visible product features
5. Keep description under 400 words
6. Use actual brand/model in SEO keywords
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    logger.debug("Phase 4 raw response", {
      correlationId,
      responseLength: text?.length,
      preview: text.slice(0, 200),
    });

    const cleaned = this._cleanJson(text);
    const parsed = this._parseJson(cleaned, correlationId);

    // ✅ POST-PROCESS: Ensure item specifics are filled
    if (parsed.itemSpecifics) {
      // Force fill required fields if they're empty
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
        parsed.itemSpecifics.Model = model_name;
      }
      if (
        !parsed.itemSpecifics.Condition ||
        parsed.itemSpecifics.Condition === "string"
      ) {
        parsed.itemSpecifics.Condition = condition;
      }

      // Remove null/placeholder values
      Object.keys(parsed.itemSpecifics).forEach((key) => {
        if (
          parsed.itemSpecifics[key] === null ||
          parsed.itemSpecifics[key] === "null" ||
          parsed.itemSpecifics[key] === "string" ||
          parsed.itemSpecifics[key] === ""
        ) {
          delete parsed.itemSpecifics[key];
        }
      });

      logger.debug("Item specifics after cleanup", {
        correlationId,
        itemSpecifics: parsed.itemSpecifics,
      });
    }

    logger.info("Phase 4 complete", {
      correlationId,
      titleLength: parsed.title?.length,
      keywordsCount: parsed.seoOptimization?.primaryKeywords?.length,
      itemSpecificsCount: Object.keys(parsed.itemSpecifics || {}).length,
    });

    return parsed;
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  // services/ai.agentic.js

  _cleanJson(text) {
    if (!text || typeof text !== "string") return "";

    let cleaned = text.trim();

    // 1️⃣ Remove markdown code fences (``` or ```json)
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    cleaned = cleaned.replace(/```/g, "");
    cleaned = cleaned.trim();

    // 2️⃣ Extract JSON object boundaries
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1) {
      // ⚠️ Truncated JSON — attempt recovery
      logger.warn("Attempting JSON recovery (truncated response detected)");
      cleaned = cleaned.substring(firstBrace);
      cleaned = this._attemptJsonRecovery(cleaned);
    } else {
      // No JSON found at all
      throw new Error("No JSON object found in AI response");
    }

    return cleaned.trim();
  }

  // Attempt to recover truncated JSON by closing open structures
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

    // Close unterminated string
    if (inString) {
      truncatedJson += '"';
    }

    // Close open arrays
    while (bracketCount > 0) {
      truncatedJson += "]";
      bracketCount--;
    }

    // Close open objects
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

  _validateSchema(data, requiredFields) {
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }
}

module.exports = new AIAgentic();
