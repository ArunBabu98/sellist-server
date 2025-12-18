const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../../config");
const logger = require("../../../config/logger.config");

class DescriptionSections {
  constructor({
    mainDescription = null,
    itemDetails = null,
    condition = null,
    greatFor = null,
  } = {}) {
    this.mainDescription = mainDescription;
    this.itemDetails = itemDetails || {};
    this.condition = condition;
    this.greatFor = greatFor || [];
  }

  static fromJson(json) {
    if (!json) return new DescriptionSections();
    return new DescriptionSections({
      mainDescription: json.mainDescription,
      itemDetails: json.itemDetails ? { ...json.itemDetails } : null,
      condition: json.condition,
      greatFor: Array.isArray(json.greatFor) ? [...json.greatFor] : null,
    });
  }

  toJson() {
    return {
      mainDescription: this.mainDescription,
      itemDetails: this.itemDetails || {},
      condition: this.condition,
      greatFor: this.greatFor || [],
    };
  }
}

class GeminiService {
  constructor() {
    if (!config.ai.geminiApiKey) {
      logger.error("Gemini API key is not configured (GEMINI_API_KEY).");
    }
    this.apiKey = config.ai.geminiApiKey;
    this.maxRetries = 3;
    this.initialDelayMs = 2000;
    this.modelName = "gemini-2.5-flash";
    this.genAI = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
  }

  async _retryWithBackoff(operation, operationName = "operation") {
    let attempt = 0;
    let delayMs = this.initialDelayMs;

    while (true) {
      attempt += 1;
      try {
        logger.debug(`${operationName}: attempt ${attempt}/${this.maxRetries}`);
        return await operation();
      } catch (err) {
        const isRetryable = this._isRetryableError(err);
        const isLast = attempt >= this.maxRetries;

        logger.warn(
          `${operationName}: attempt ${attempt} failed: ${
            err.message || err
          } (retryable=${isRetryable})`
        );

        if (!isRetryable || isLast) {
          logger.error(`${operationName}: giving up after ${attempt} attempts`);
          throw err;
        }

        logger.debug(`${operationName}: waiting ${delayMs}ms before retry`);
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }

  _isRetryableError(error) {
    const msg = (error && error.message) || String(error || "");
    if (
      msg.includes("503") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("504") ||
      msg.includes("429") ||
      msg.toLowerCase().includes("overloaded")
    ) {
      return true;
    }

    if (
      msg.toLowerCase().includes("socket") ||
      msg.toLowerCase().includes("connection") ||
      msg.toLowerCase().includes("timeout")
    ) {
      return true;
    }

    return false;
  }

  _cleanJsonResponse(text) {
    if (!text || typeof text !== "string") return "";

    let cleaned = text.trim();

    // 1️⃣ Remove markdown code fences like ```json or ```lang (only at start)
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");

    // Remove closing ``` at the end
    cleaned = cleaned.replace(/\s*```$/, "");

    // 2️⃣ Remove any remaining triple backticks (fallback safety)
    cleaned = cleaned.replace(/```/g, "");

    cleaned = cleaned.trim();

    // 3️⃣ Extract JSON object if extra text exists
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return cleaned.trim();
  }

  _buildSingleImagePrompt() {
    return `
Analyze the product image(s) and generate a complete eBay listing.

Return ONLY valid JSON with these exact fields:

{
  "title": "SEO-optimized title (max 80 chars, front-load keywords)",
  "descriptionSections": {
    "mainDescription": "2-3 sentence overview highlighting key features",
    "itemDetails": {
      "Character": "Name",
      "Brand": "Company",
      "Year": "YYYY"
    },
    "condition": "Detailed condition description with specific flaws/wear",
    "greatFor": ["Collectors", "Gifts", "Display"],
    "seoKeywords": ["keyword1", "keyword2"]
  },
  "pricing": {
    "suggestedPrice": 14.95,
    "currency": "USD",
    "compRange": "7.99-17.99",
    "strategy": "Competitive pricing strategy"
  },
  "itemSpecifics": {
    "Brand": "value",
    "Condition": "Pre-Owned",
    "Year": "2003"
  },
  "categories": {
    "primary": "Toys & Hobbies > Action Figures",
    "secondary": "Collectibles > Vintage"
  },
  "shipping": {
    "estimatedWeight": "4 oz",
    "handlingTime": "1 business day",
    "method": "USPS First Class"
  },
  "policies": {
    "returns": "30-day returns accepted",
    "returnShipping": "Buyer pays return shipping"
  },
  "flaws": ["Visible wear", "Minor scratches"]
}

Requirements:
1. Create a keyword-rich title starting with most searchable terms
2. Identify specific product, brand, model, year if visible
3. Note ALL visible condition issues in flaws array
4. Suggest realistic pricing based on condition and rarity
5. Fill out 15-20+ item specifics fields
6. Include SEO keywords buyers search for
7. Be honest about flaws
`.trim();
  }

  _buildMultiImagePrompt() {
    return `
Analyze the product image(s) and generate a complete eBay listing.

Return ONLY valid JSON with these exact fields:

{
  "title": "SEO-optimized title (max 80 chars, front-load keywords)",
  "descriptionSections": {
    "mainDescription": "2-3 sentence overview highlighting key features",
    "itemDetails": {
      "Character": "Name",
      "Brand": "Company",
      "Year": "YYYY"
    },
    "condition": "Detailed condition description with specific flaws/wear",
    "greatFor": ["Collectors", "Gifts", "Display"],
    "seoKeywords": ["keyword1", "keyword2"]
  },
  "pricing": {
    "suggestedPrice": 14.95,
    "currency": "USD",
    "compRange": "7.99-17.99",
    "strategy": "Competitive pricing strategy"
  },
  "itemSpecifics": {
    "Brand": "value",
    "Condition": "Pre-Owned",
    "Year": "2003",
    "Type": "Action Figure"
  },
  "categories": {
    "primary": "Toys & Hobbies > Action Figures",
    "secondary": "Collectibles > Vintage"
  },
  "shipping": {
    "estimatedWeight": "4 oz",
    "handlingTime": "1 business day",
    "method": "USPS First Class"
  },
  "policies": {
    "returns": "30-day returns accepted",
    "returnShipping": "Buyer pays return shipping"
  },
  "flaws": ["Visible wear", "Minor scratches"]
}

Requirements:
1. Create a keyword-rich title starting with most searchable terms
2. Identify specific product, brand, model, year if visible
3. Note ALL visible condition issues in flaws array
4. Suggest realistic pricing based on condition and rarity
5. Fill out 15-20+ item specifics fields
6. Include SEO keywords buyers search for
7. Be honest about flaws
8. Analyze all provided images to get complete product information
`.trim();
  }

  async analyzeSingleImageFromBase64(base64, mimeType = "image/jpeg") {
    if (!this.apiKey || !this.genAI) {
      throw new Error("Gemini API key not configured on server");
    }

    const buffer = Buffer.from(base64, "base64");
    return this._retryWithBackoff(
      () => this._analyzeSingleImage(buffer, mimeType),
      "analyzeSingleImage"
    );
  }

  async analyzeMultipleImagesFromBase64(images) {
    if (!this.apiKey || !this.genAI) {
      throw new Error("Gemini API key not configured on server");
    }

    const buffers = images.map((img) => ({
      mimeType: img.mimeType || "image/jpeg",
      buffer: Buffer.from(img.base64, "base64"),
    }));

    return this._retryWithBackoff(
      () => this._analyzeMultipleImages(buffers),
      "analyzeMultipleImages"
    );
  }

  async _analyzeSingleImage(buffer, mimeType) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildSingleImagePrompt();

    const parts = [
      { text: prompt },
      {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType,
        },
      },
    ];

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });
    const text = result.response.text();

    if (!text) throw new Error("Empty response from Gemini");

    const cleaned = this._cleanJsonResponse(text);
    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (err) {
      logger.error("JSON parse error (single image):", {
        error: err.message,
        cleanedPreview: cleaned.slice(0, 500),
      });
      throw new Error("AI response could not be parsed as JSON");
    }

    return this._mapToListingPayload(data);
  }

  async _analyzeMultipleImages(buffers) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildMultiImagePrompt();

    const parts = [{ text: prompt }];
    let totalBytes = 0;

    for (const item of buffers) {
      totalBytes += item.buffer.length;
      parts.push({
        inlineData: {
          data: item.buffer.toString("base64"),
          mimeType: item.mimeType,
        },
      });
    }

    logger.debug("analyzeMultipleImages: totalBytes", {
      totalBytes,
      count: buffers.length,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });
    const text = result.response.text();

    if (!text) throw new Error("Empty response from Gemini");

    const cleaned = this._cleanJsonResponse(text);
    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (err) {
      logger.error("JSON parse error (multi-image):", {
        error: err.message,
        cleanedPreview: cleaned.slice(0, 500),
      });
      throw new Error("AI response could not be parsed as JSON");
    }

    return this._mapToListingPayload(data);
  }

  _mapToListingPayload(data) {
    const descSections = DescriptionSections.fromJson(data.descriptionSections);
    const categories = data.categories || {};
    const pricing = data.pricing || {};
    const shipping = data.shipping || {};
    const policies = data.policies || {};

    return {
      title: data.title || "Unknown Item",
      descriptionSections: descSections.toJson(),
      category: categories.primary || data.category || "Other",
      primaryCategory: categories.primary || "Other",
      secondaryCategory: categories.secondary || null,
      pricing: {
        suggestedPrice:
          typeof pricing.suggestedPrice === "number"
            ? pricing.suggestedPrice
            : parseFloat(pricing.suggestedPrice) || 0,
        currency: pricing.currency || "USD",
        compRange: pricing.compRange || null,
        strategy: pricing.strategy || null,
      },
      itemSpecifics: data.itemSpecifics || {},
      shipping: {
        estimatedWeight: shipping.estimatedWeight || null,
        handlingTime: shipping.handlingTime || null,
        method: shipping.method || null,
      },
      policies: {
        returns: policies.returns || null,
        returnShipping:
          policies.returnShipping || policies.returnShippingPaidBy || null,
      },
      flaws: Array.isArray(data.flaws) ? data.flaws : [],
      seoKeywords:
        Array.isArray(descSections.greatFor) && descSections.greatFor.length > 0
          ? descSections.greatFor
          : Array.isArray(data.seoKeywords)
          ? data.seoKeywords
          : [],
    };
  }
}

module.exports = new GeminiService();
