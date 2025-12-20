const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");
const config = require("../../../config");
const logger = require("../../../config/logger.config");

class GeminiService {
  constructor() {
    if (!config.ai.geminiApiKey) {
      logger.error("Gemini API key is not configured");
      throw new Error("Gemini API key is required");
    }
    this.apiKey = config.ai.geminiApiKey;
    this.maxRetries = 3;
    this.initialDelayMs = 2000;
    this.modelName = "gemini-2.5-flash";
    this.genAI = new GoogleGenerativeAI(this.apiKey);

    // Image validation constants
    this.MAX_IMAGE_SIZE_MB = 20;
    this.ALLOWED_MIME_TYPES = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
    this.MAX_IMAGES_PER_REQUEST = 16;
  }

  // ============================================================================
  // PUBLIC API METHODS
  // ============================================================================

  /**
   * Analyzes a single product image and generates a complete listing
   * @param {string} base64 - Base64 encoded image
   * @param {string} mimeType - Image MIME type
   * @param {Object} options - Additional options
   * @param {Object} options.sellerConfig - Seller's shipping templates, policies
   * @param {Array<Object>} options.marketData - Sold listings data for pricing
   * @param {string} options.userProvidedCondition - User-specified condition
   * @param {string} options.customHtmlTemplate - Custom HTML template
   * @param {Array<string>} options.hostedImageUrls - URLs for embedding in HTML
   * @returns {Promise<Object>} Complete listing data
   */
  async analyzeSingleImage(base64, mimeType = "image/jpeg", options = {}) {
    const correlationId = this._generateCorrelationId();
    logger.info("Starting single image analysis", { correlationId });

    try {
      this._validateImageInput(base64, mimeType);
      const buffer = Buffer.from(base64, "base64");

      return await this._retryWithBackoff(
        () =>
          this._analyzeImageWithContext(
            buffer,
            mimeType,
            options,
            correlationId
          ),
        "analyzeSingleImage",
        correlationId
      );
    } catch (error) {
      logger.error("Single image analysis failed", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Analyzes multiple images of the SAME product
   * @param {Array<Object>} images - Array of {base64, mimeType}
   * @param {Object} options - Additional options (same as analyzeSingleImage)
   * @returns {Promise<Object>} Complete listing data
   */
  async analyzeMultipleImages(images, options = {}) {
    const correlationId = this._generateCorrelationId();
    logger.info("Starting multi-image analysis", {
      correlationId,
      imageCount: images.length,
    });

    try {
      if (!Array.isArray(images) || images.length === 0) {
        throw new Error("Images array is required and must not be empty");
      }

      if (images.length > this.MAX_IMAGES_PER_REQUEST) {
        throw new Error(
          `Maximum ${this.MAX_IMAGES_PER_REQUEST} images allowed per request`
        );
      }

      const buffers = images.map((img, idx) => {
        this._validateImageInput(img.base64, img.mimeType || "image/jpeg");
        return {
          mimeType: img.mimeType || "image/jpeg",
          buffer: Buffer.from(img.base64, "base64"),
          index: idx,
        };
      });

      // 2️⃣ Phase 0 — Visual Image Role + Quality Check
      const visualAnalysis = await this._retryWithBackoff(
        () => this.aiAgentic.visualImageID(buffers, correlationId),
        "visualImageID",
        correlationId
      );

      // 3️⃣ Select ONLY recommended images
      const selectedBuffers = buffers.filter((b) =>
        visualAnalysis.summary.recommendedForAI.includes(b.index)
      );

      // 4️⃣ Safety fallback
      if (selectedBuffers.length === 0) {
        logger.warn(
          "No suitable images after visual analysis, falling back to first image",
          {
            correlationId,
          }
        );
        selectedBuffers.push(buffers[0]);
      }

      // 5️⃣ Continue with product intelligence
      return await this._retryWithBackoff(
        () =>
          this._analyzeMultipleImagesWithContext(
            selectedBuffers,
            {
              ...options,
              visualAnalysis, // pass forward for transparency/UI
            },
            correlationId
          ),
        "analyzeMultipleImages",
        correlationId
      );
    } catch (error) {
      logger.error("Multi-image analysis failed", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * BULK MODE: Separates multiple products from uploaded images
   * Each product gets its own listing
   * @param {Array<Object>} images - Array of {base64, mimeType}
   * @param {Object} options - Additional options
   * @returns {Promise<Array<Object>>} Array of listing data, one per product
   */
  async analyzeBulkProducts(images, options = {}) {
    const correlationId = this._generateCorrelationId();
    logger.info("Starting bulk product separation", {
      correlationId,
      imageCount: images.length,
    });

    try {
      if (!Array.isArray(images) || images.length === 0) {
        throw new Error("Images array is required for bulk analysis");
      }

      if (images.length > this.MAX_IMAGES_PER_REQUEST) {
        throw new Error(
          `Maximum ${this.MAX_IMAGES_PER_REQUEST} images allowed per bulk request`
        );
      }

      const buffers = images.map((img, idx) => {
        this._validateImageInput(img.base64, img.mimeType || "image/jpeg");
        return {
          mimeType: img.mimeType || "image/jpeg",
          buffer: Buffer.from(img.base64, "base64"),
          index: idx,
        };
      });

      const visualAnalysis = await this._retryWithBackoff(
        () => this.aiAgentic.visualImageID(buffers, correlationId),
        "visualImageID",
        correlationId
      );

      return await this._retryWithBackoff(
        () =>
          this._analyzeBulkProductSeparation(
            buffers,
            {
              ...options,
              visualAnalysis,
            },
            correlationId
          ),
        "analyzeBulkProducts",
        correlationId
      );
    } catch (error) {
      logger.error("Bulk product analysis failed", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generates HTML listing template based on listing data
   * @param {Object} listingData - Basic listing information
   * @param {Object} options - Template options
   * @param {string} options.customHtml - User's custom HTML template
   * @param {Array<string>} options.hostedImageUrls - Image URLs to embed
   * @param {Object} options.branding - Seller branding (logo, colors, store name)
   * @returns {Promise<string>} HTML template string
   */
  async generateHtmlTemplate(listingData, options = {}) {
    const correlationId = this._generateCorrelationId();
    logger.info("Generating HTML template", { correlationId });

    try {
      return await this._retryWithBackoff(
        () =>
          this._generateHtmlFromListing(listingData, options, correlationId),
        "generateHtmlTemplate",
        correlationId
      );
    } catch (error) {
      logger.error("HTML template generation failed", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Drafts seller Terms of Service
   * @param {Object} sellerInfo - Business name, policies, etc.
   * @returns {Promise<Object>} {returns, warranties, disclaimers}
   */
  async draftTermsOfService(sellerInfo = {}) {
    const correlationId = this._generateCorrelationId();
    logger.info("Drafting Terms of Service", { correlationId });

    try {
      return await this._retryWithBackoff(
        () => this._generateTermsOfService(sellerInfo, correlationId),
        "draftTermsOfService",
        correlationId
      );
    } catch (error) {
      logger.error("Terms of Service generation failed", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================================
  // CORE ANALYSIS METHODS
  // ============================================================================

  async _analyzeImageWithContext(buffer, mimeType, options, correlationId) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildComprehensivePrompt(options, false);

    const parts = [
      { text: prompt },
      {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType,
        },
      },
    ];

    logger.debug("Sending request to Gemini", {
      correlationId,
      bufferSize: buffer.length,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    logger.debug("Received response from Gemini", {
      correlationId,
      responseLength: text.length,
    });

    const cleaned = this._cleanJsonResponse(text);
    const data = this._parseJsonSafely(cleaned, correlationId);

    return this._mapToListingPayload(data, options);
  }

  async _analyzeMultipleImagesWithContext(buffers, options, correlationId) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildComprehensivePrompt(options, true);

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

    logger.debug("Sending multi-image request to Gemini", {
      correlationId,
      totalBytes,
      imageCount: buffers.length,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    const cleaned = this._cleanJsonResponse(text);
    const data = this._parseJsonSafely(cleaned, correlationId);

    return this._mapToListingPayload(data, options);
  }

  async _analyzeBulkProductSeparation(buffers, options, correlationId) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildBulkSeparationPrompt(options);

    const parts = [{ text: prompt }];
    for (const item of buffers) {
      parts.push({
        inlineData: {
          data: item.buffer.toString("base64"),
          mimeType: item.mimeType,
        },
      });
    }

    logger.debug("Sending bulk separation request to Gemini", {
      correlationId,
      imageCount: buffers.length,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    const cleaned = this._cleanJsonResponse(text);
    const data = this._parseJsonSafely(cleaned, correlationId);

    // Expected format: { products: [{...}, {...}] }
    if (!data.products || !Array.isArray(data.products)) {
      throw new Error("Invalid bulk response format: missing products array");
    }

    return data.products.map((product) =>
      this._mapToListingPayload(product, options)
    );
  }

  async _generateHtmlFromListing(listingData, options, correlationId) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildHtmlTemplatePrompt(listingData, options);

    logger.debug("Generating HTML template", { correlationId });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty HTML template response from Gemini API");
    }

    // Extract HTML from potential markdown code blocks
    let html = text.trim();
    html = html.replace(/^``````$/, "");
    html = html.replace(/^``````$/, "");

    return html;
  }

  async _generateTermsOfService(sellerInfo, correlationId) {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const prompt = this._buildTermsOfServicePrompt(sellerInfo);

    logger.debug("Generating Terms of Service", { correlationId });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = result.response.text();
    if (!text) {
      throw new Error("Empty Terms of Service response from Gemini API");
    }

    const cleaned = this._cleanJsonResponse(text);
    const data = this._parseJsonSafely(cleaned, correlationId);

    return data;
  }

  // ============================================================================
  // PROMPT BUILDERS
  // ============================================================================

  _buildComprehensivePrompt(options = {}, isMultiImage = false) {
    const {
      sellerConfig = {},
      marketData = [],
      userProvidedCondition = null,
      hostedImageUrls = [],
    } = options;

    let prompt = `You are an expert eBay listing creator with deep knowledge of SEO, pricing intelligence, shipping optimization, and HTML template design.

**TASK**: Analyze the product image(s) and generate a complete, production-ready eBay listing optimized for maximum sales conversion.

${
  isMultiImage
    ? `
**MULTI-IMAGE ANALYSIS INSTRUCTIONS:**
- Examine ALL images to identify the product from different angles
- Look for brand tags, labels, size indicators, serial numbers across all photos
- Note ALL visible flaws, wear patterns, or defects in ANY image
- Combine information from all images to create ONE complete, accurate listing
- Reference specific images when describing features (e.g., "close-up in image 3 shows...")
`
    : ""
}

**OUTPUT FORMAT (VALID JSON ONLY - NO MARKDOWN, NO EXPLANATIONS):**

\`\`\`json
{
  "productIdentification": {
    "brand": "Exact brand name (or 'Unbranded' if not visible)",
    "model": "Specific model name/number",
    "category": "eBay category path (e.g., 'Electronics > Cell Phones & Accessories > Cell Phones & Smartphones')",
    "upc": "UPC/EAN if visible, else null",
    "mpn": "Manufacturer Part Number if visible, else null"
  },

  "title": "SEO-optimized title (80 chars max) - Format: Brand Model Feature Color Size Condition",
  "subtitle": "Optional extra keywords (55 chars max) or null",
  
  "description": {
    "plainText": "Detailed buyer-focused description (500-1500 words)",
    "structure": {
      "hook": "Opening 2-3 sentences highlighting key selling points",
      "conditionDetails": "Honest assessment with 10-point scale, ALL flaws disclosed",
      "keyFeatures": ["Feature 1", "Feature 2", "Feature 3", "..."],
      "specifications": "Technical specs, measurements, materials",
      "included": "What's in the package, missing items noted",
      "whyBuyFromMe": "Shipping speed, return policy, seller rating highlights"
    }
  },

  "condition": {
    "grade": "MUST be one of: New|New with tags|New without tags|New with defects|Manufacturer refurbished|Seller refurbished|Used|Like New|Very Good|Good|Acceptable|For parts or not working",
    "numericScore": 8.5,
    "description": "Detailed condition notes: wear, flaws, functionality, cleanliness (3-5 sentences)",
    "flaws": ["Flaw 1", "Flaw 2"],
    "userOverride": ${
      userProvidedCondition ? `"${userProvidedCondition}"` : "null"
    }
  },

  "weight": {
    "estimatedLbs": 2.5,
    "estimatedOz": 40,
    "estimatedKg": 1.13,
    "confidenceLevel": "high|medium|low",
    "requiresManualVerification": false,
    "rationale": "Brief explanation of weight estimate based on product type and visible size"
  },

  "dimensions": {
    "length": 12.0,
    "width": 8.0,
    "height": 3.0,
    "unit": "inches",
    "confidenceLevel": "high|medium|low"
  },

  "pricing": {
    "suggestedPrice": 49.99,
    "priceRange": {
      "min": 39.99,
      "max": 59.99
    },
    "currency": "USD",
    "confidenceScore": 0.85,
    "rationale": "Pricing justification based on condition, market data, and category",
    "marketAnalysis": {
      "soldListingsAnalyzed": ${marketData.length},
      "averageSoldPrice": null,
      "priceDistribution": "Description of price ranges found in market research",
      "competitivePosition": "How this listing compares to similar items"
    },
    "strategyRecommendation": {
      "listingFormat": "Fixed Price|Auction|Both",
      "auctionStartPrice": null,
      "bestOfferEnabled": true,
      "bestOfferAutoAccept": 47.99,
      "bestOfferAutoDecline": 35.00,
      "shippingStrategy": "Buyer Pays|Free Shipping|Calculated",
      "reasoning": "Why this strategy maximizes sales for this specific item"
    }
  },

  "shipping": {
    "recommendedService": "USPS Priority Mail|USPS First Class|UPS Ground|FedEx Ground|FedEx Home Delivery",
    "estimatedCost": 8.50,
    "handlingTime": "Same business day|1 business day|2 business days|3 business days|4 business days|5 business days",
    "packageType": "Box|Padded envelope|Flat rate box|Large package",
    "requiresSignature": false,
    "fragile": false,
    "sellerTemplateMatch": ${
      sellerConfig.shippingTemplates
        ? `"${sellerConfig.shippingTemplates[0]?.name || "Standard Template"}"`
        : "null"
    }
  },

  "itemSpecifics": {
    "Brand": "Nike",
    "Model": "Air Max 90",
    "Size": "10.5",
    "Color": "White/Black",
    "Material": "Leather",
    "Style": "Athletic",
    "Condition": "Used",
    "Year": "2023",
    "Country/Region of Manufacture": "Vietnam"
  },

  "seoOptimization": {
    "primaryKeywords": ["keyword1", "keyword2", "keyword3"],
    "secondaryKeywords": ["keyword4", "keyword5", "keyword6"],
    "longtailKeywords": ["specific phrase 1", "specific phrase 2"],
    "competitorKeywords": ["keywords found in top-performing similar listings"],
    "searchVolume": "Analysis of keyword popularity and competition"
  },

  "listingRecommendations": {
    "bestOfferEnabled": true,
    "internationalShipping": false,
    "returnsAccepted": true,
    "returnPeriod": "14 days|30 days|60 days",
    "returnShippingPaidBy": "Buyer|Seller",
    "promotedListings": {
      "recommended": true,
      "suggestedAdRate": "5%",
      "reasoning": "Why promoted listings would benefit this item"
    }
  },

  "qualityChecks": {
    "imageQuality": "excellent|good|acceptable|poor",
    "imageQualityNotes": "Multiple angles, good lighting, clear details",
    "informationCompleteness": 0.95,
    "missingInformation": ["List any critical details not visible in images"],
    "recommendedAdditionalPhotos": ["Suggest specific photos that would improve listing"]
  },

  "complianceFlags": {
    "brandAuthenticity": "verified|likely authentic|uncertain|counterfeit risk",
    "prohibitedItems": false,
    "restrictedCategories": false,
    "requiresAdditionalDisclosures": false,
    "warnings": ["Any compliance concerns or required disclosures"]
  },

  "legalDisclaimers": {
    "pricing": "AI-suggested prices are estimates based on market analysis. Seller is solely responsible for final pricing decisions. Actual market value may vary.",
    "condition": "AI condition assessment is preliminary. Seller must verify and accurately represent item condition in final listing.",
    "accuracy": "All AI-generated content is advisory. Seller is responsible for ensuring listing accuracy and compliance with eBay policies.",
    "liability": "AI suggestions do not guarantee sales performance or listing acceptance by eBay."
  }
}
\`\`\`

**CRITICAL REQUIREMENTS:**

1. **PRODUCT IDENTIFICATION:**
   - Identify exact brand and model from visible logos, tags, or packaging
   - Search for UPC/EAN codes, serial numbers, or model numbers
   - If brand is uncertain, use "Unbranded" or "Unknown Brand"
   - Never fabricate brand names

2. **TITLE OPTIMIZATION (80 chars max):**
   - Template: [Brand] [Model] [Key Feature] [Color] [Size] [Condition]
   - Front-load highest-value keywords (brand, model)
   - Include size, color, and condition in title
   - Examples:
     ✓ "Nike Air Max 90 White Black Leather Running Shoes Men's Size 10.5 Used"
     ✓ "Apple iPhone 13 Pro 128GB Sierra Blue Unlocked Excellent Condition"

3. **WEIGHT ESTIMATION (MANDATORY):**
   - **CRITICAL**: You MUST estimate weight based on the product category and visible size
   - Estimate weight based on product category, size, and materials
  - Product category weight reference guide:
    * **Electronics**:
      - Smartphone: 0.3-0.5 lbs (5-8 oz, 0.14-0.23 kg)
      - Tablet: 1-1.5 lbs (16-24 oz, 0.45-0.68 kg)
      - Laptop: 3-6 lbs (48-96 oz, 1.4-2.7 kg)
      - Smartwatch: 0.1-0.2 lbs (2-3 oz, 0.05-0.09 kg)
      - Headphones: 0.3-0.8 lbs (5-13 oz, 0.14-0.36 kg)
    * **Footwear**:
      - Athletic shoes (men's): 1.5-2.5 lbs (24-40 oz, 0.68-1.13 kg)
      - Athletic shoes (women's): 1-1.8 lbs (16-29 oz, 0.45-0.82 kg)
      - Boots: 2-4 lbs (32-64 oz, 0.91-1.81 kg)
      - Sandals: 0.5-1 lbs (8-16 oz, 0.23-0.45 kg)
    * **Clothing**:
      - T-shirt: 0.3-0.5 lbs (5-8 oz, 0.14-0.23 kg)
      - Jeans: 1-1.5 lbs (16-24 oz, 0.45-0.68 kg)
      - Jacket: 1-3 lbs (16-48 oz, 0.45-1.36 kg)
      - Hoodie: 0.8-1.2 lbs (13-19 oz, 0.36-0.54 kg)
    * **Toys**:
      - Action figures: 0.2-0.5 lbs (3-8 oz, 0.09-0.23 kg)
      - Board games: 1-3 lbs (16-48 oz, 0.45-1.36 kg)
      - Video games (boxed): 0.3-0.5 lbs (5-8 oz, 0.14-0.23 kg)
    * **Books**:
      - Paperback: 0.3-0.8 lbs (5-13 oz, 0.14-0.36 kg)
      - Hardcover: 1-2 lbs (16-32 oz, 0.45-0.91 kg)
    * **Home & Garden**:
      - Small decor: 0.5-2 lbs (8-32 oz, 0.23-0.91 kg)
      - Cookware: 2-5 lbs (32-80 oz, 0.91-2.27 kg)
      
  - **Add 10-20% for packaging** (box, bubble wrap, padding)
  - If you cannot determine category, estimate 1-2 lbs as safe default
  - Set \`requiresManualVerification: true\` if uncertain
  - Set \`confidenceLevel\` based on visibility of size indicators:
    * "high": Size clearly visible (shoe box with size label, clothing tag visible)
    * "medium": Category known but exact size unclear
    * "low": Product type unclear or size ambiguous

4. **PRICING INTELLIGENCE:**
   ${
     marketData.length > 0
       ? `
   - Analyze the provided sold listings data (${marketData.length} items)
   - Calculate average, median, and price distribution
   - Adjust for condition differences vs. comparable items
   - Recommend listing format (Fixed Price vs Auction) based on market velocity
   - Suggest Best Offer thresholds (auto-accept at 95-98%, auto-decline at 70-80%)
   `
       : `
   - Estimate pricing based on product category, brand, condition
   - Note that actual market data was not provided
   - Use conservative estimates to avoid overpricing
   - Flag that seller should research sold listings manually
   `
   }

5. **PRICING STRATEGY:**
   - **Fixed Price**: Best for known-value items, collectibles, new items
   - **Auction**: Best for rare items, uncertain value, creating urgency
   - **Best Offer**: Enables negotiation, good for items $30+
   - **Free Shipping**: Increases conversion but factor into price
   - Provide clear reasoning for strategy recommendation

6. **SHIPPING OPTIMIZATION:**
   ${
     sellerConfig.shippingTemplates
       ? `
   - Match recommended shipping to seller's pre-configured templates
   - Available templates: ${JSON.stringify(
     sellerConfig.shippingTemplates.map((t) => t.name)
   )}
   `
       : ""
   }
   - Calculate shipping cost based on weight, dimensions, and service
   - Choose fastest affordable option (Priority Mail for most items)
   - Flag if item is oversized, fragile, or requires special handling

7. **HTML TEMPLATE PREPARATION:**
   - Structure description for easy HTML conversion
   - Use clear sections with headers
   - Organize features as bullet points
   - Include calls-to-action ("Buy with confidence", "Fast shipping")
   ${
     hostedImageUrls.length > 0
       ? `
   - Reference these hosted image URLs: ${JSON.stringify(hostedImageUrls)}
   `
       : ""
   }

8. **SEO OPTIMIZATION:**
   - Research actual buyer search terms (not just product features)
   - Include long-tail keywords that match buyer intent
   - Add common misspellings if relevant (e.g., "Addidas" for Adidas)
   - Avoid keyword stuffing or spammy terms
   - Use keywords that appear in top-performing sold listings

9. **CONDITION ASSESSMENT:**
   - Be ruthlessly honest about condition
   - Use 10-point numeric scale (10 = perfect, 1 = for parts only)
   - List ALL visible flaws, no matter how minor
   - Note: "Like New" = 9-9.5, "Very Good" = 8-8.5, "Good" = 7-7.5
   - Disclose if smoke/pet-free, if item has odors, if functional issues exist

10. **COMPLIANCE & AUTHENTICITY:**
    - Flag potential counterfeit items (misspelled brands, wrong logos)
    - Note if item is in restricted category (requires approval)
    - Warn if prohibited content visible (weapons, alcohol, medical devices)
    - Suggest authenticity verification for high-value branded items

11. **QUALITY CHECKS:**
    - Assess image quality (lighting, focus, angles, background)
    - List missing information that seller should provide
    - Recommend additional photos (size tag close-up, defect photos, etc.)
    - Rate overall information completeness (0.0 - 1.0)

12. **HONESTY OVER OPTIMIZATION:**
    - Never invent details not visible in images
    - Don't claim "New" unless sealed in original packaging
    - Don't hide flaws to inflate price
    - Accurate listings = fewer returns = better seller rating

**RESPOND ONLY WITH THE JSON OBJECT. NO MARKDOWN CODE FENCES, NO EXPLANATIONS BEFORE OR AFTER.**`;

    return prompt;
  }

  _buildBulkSeparationPrompt(options = {}) {
    const { sellerConfig = {}, marketData = [] } = options;

    return `You are an expert at identifying and separating multiple products from bulk image uploads for eBay listing creation.

**TASK**: Analyze ALL uploaded images and identify DISTINCT PRODUCTS. Each unique product should get its own listing.

**SEPARATION LOGIC:**
- If images show the SAME product from different angles → Group as ONE product
- If images show DIFFERENT products → Separate into MULTIPLE products
- Look for: different brands, models, colors, sizes, SKUs, or completely different items
- A "set" or "bundle" of identical items = ONE product listing

**OUTPUT FORMAT (VALID JSON ONLY):**

\`\`\`json
{
  "products": [
    {
      "productId": 1,
      "imageIndices": [0, 1, 2],
      "separationReasoning": "Nike Air Max sneakers - images 0, 1, 2 show same pair from different angles",
      
      "productIdentification": {
        "brand": "Nike",
        "model": "Air Max 90",
        "category": "Clothing, Shoes & Accessories > Men's Shoes > Athletic Shoes"
      },

      "title": "Nike Air Max 90 White Black Leather Men's Size 10.5 Pre-Owned",
      "subtitle": null,
      
      "condition": {
        "grade": "Used",
        "numericScore": 8.0,
        "description": "Good pre-owned condition with minor creasing"
      },

      "weight": {
        "estimatedLbs": 2.0,
        "estimatedOz": 32,
        "estimatedKg": 0.91,
        "confidenceLevel": "high",
        "requiresManualVerification": false
      },

      "pricing": {
        "suggestedPrice": 75.00,
        "priceRange": { "min": 65.00, "max": 85.00 },
        "currency": "USD",
        "confidenceScore": 0.80,
        "strategyRecommendation": {
          "listingFormat": "Fixed Price",
          "bestOfferEnabled": true,
          "shippingStrategy": "Buyer Pays"
        }
      },

      "shipping": {
        "recommendedService": "USPS Priority Mail",
        "estimatedCost": 9.50,
        "handlingTime": "1 business day"
      },

      "itemSpecifics": {
        "Brand": "Nike",
        "Model": "Air Max 90",
        "Size": "10.5",
        "Color": "White/Black"
      },

      "seoOptimization": {
        "primaryKeywords": ["nike air max", "mens sneakers", "athletic shoes"]
      },

      "legalDisclaimers": {
        "pricing": "AI-suggested prices are estimates. Seller is responsible for final pricing.",
        "condition": "AI condition assessment is preliminary. Seller must verify accuracy.",
        "accuracy": "All AI content is advisory. Seller ensures listing compliance."
      }
    },
    {
      "productId": 2,
      "imageIndices": [3, 4],
      "separationReasoning": "Adidas Ultraboost sneakers - images 3, 4 show DIFFERENT product than product 1",
      
      ... (complete listing data for product 2)
    }
  ],
  
  "bulkSummary": {
    "totalImagesUploaded": 5,
    "distinctProductsDetected": 2,
    "imageAssignmentConfidence": 0.95,
    "unassignedImages": [],
    "processingNotes": "All images successfully assigned to products. High confidence in separation."
  }
}
\`\`\`

**SEPARATION RULES:**

1. **Different Products:**
   - Different brands (Nike vs Adidas)
   - Different models within same brand (iPhone 13 vs iPhone 14)
   - Different colors of same model IF sold separately
   - Different sizes IF sold separately
   - Completely different categories (shoes vs electronics)

2. **Same Product (multiple angles):**
   - Front, back, side views of SAME item
   - Close-ups of logos, tags, defects on SAME item
   - Different lighting/background but clearly SAME physical item
   - Packaging + unboxed shots of SAME product

3. **Edge Cases:**
   - **Pairs/Sets**: If images show matching pair (shoes, earbuds), treat as ONE product
   - **Bundles**: If seller intends to sell items together, treat as ONE bundle listing
   - **Variations**: If images show size tag + product, group together
   - **Ambiguous**: If uncertain, ASK in processingNotes and default to SEPARATE listings

4. **Quality Checks:**
   - Flag poor quality images that can't be confidently assigned
   - Note if additional photos needed to confirm product identity
   - Warn if images don't clearly show distinct products

**Each product listing must include:**
- Complete product identification
- Full listing data (title, description structure, condition, pricing, shipping)
- Weight estimation (MANDATORY)
- SEO optimization
- Legal disclaimers

**RESPOND ONLY WITH THE JSON OBJECT. NO MARKDOWN, NO EXPLANATIONS.**`;
  }

  _buildHtmlTemplatePrompt(listingData, options = {}) {
    const { customHtml = null, hostedImageUrls = [], branding = {} } = options;

    const {
      storeName = "Our Store",
      logoUrl = null,
      primaryColor = "#0066CC",
      secondaryColor = "#F0F0F0",
    } = branding;

    return `You are an expert HTML template designer for eBay listings.

**TASK**: Generate a professional, mobile-responsive HTML listing template using the provided listing data.

**LISTING DATA:**
${JSON.stringify(listingData, null, 2)}

**HOSTED IMAGE URLs (embed these):**
${
  hostedImageUrls.length > 0
    ? JSON.stringify(hostedImageUrls, null, 2)
    : "None provided - use placeholder image tags"
}

**BRANDING:**
- Store Name: ${storeName}
- Logo URL: ${logoUrl || "None"}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}

${
  customHtml
    ? `
**CUSTOM HTML TEMPLATE (enhance this):**
${customHtml}
`
    : ""
}

**REQUIREMENTS:**

1. **Structure:**
   - Clean, professional design
   - Mobile-responsive (eBay mobile app compatible)
   - Clear sections: Hero Image, Condition, Features, Specs, Shipping, Returns
   - Strong call-to-action buttons

2. **Image Embedding:**
   - Use provided hosted image URLs
   - Format: <img src="URL" alt="description" style="max-width:100%; height:auto;">
   - Include image gallery if multiple images provided

3. **Typography:**
   - Readable fonts (Arial, Helvetica, sans-serif)
   - Clear hierarchy (h2, h3 tags)
   - Sufficient line spacing

4. **Color Scheme:**
   - Use branding colors consistently
   - Ensure good contrast for readability
   - Professional, not garish

5. **Content Sections:**
   - **Header**: Store name/logo, item title
   - **Hero Image**: Main product photo
   - **Condition Banner**: Highlight condition grade with visual indicator
   - **Key Features**: Bullet points with icons
   - **Detailed Description**: Organized paragraphs
   - **Specifications Table**: Clean 2-column table
   - **What's Included**: Checklist format
   - **Shipping & Returns**: Clear policies with icons
   - **Footer**: Store policies, contact info, social proof

6. **eBay Compliance:**
   - No external links (eBay blocks them)
   - No JavaScript or active content
   - Inline CSS only (no external stylesheets)
   - No forms or input elements
   - Max width: 800px for optimal display

7. **Enhancements:**
   - Use HTML entities for special characters (&nbsp;, &mdash;, etc.)
   - Add subtle borders and shadows for visual depth
   - Include trust badges (Top Rated Seller, Fast Shipping, etc.)
   - Mobile-first responsive design

**RESPOND WITH ONLY THE HTML CODE. NO EXPLANATIONS, NO MARKDOWN CODE FENCES.**`;
  }

  _buildTermsOfServicePrompt(sellerInfo = {}) {
    const {
      businessName = "Seller",
      returnPeriod = "30 days",
      warrantyOffered = false,
      restockingFee = false,
      internationalShipping = false,
    } = sellerInfo;

    return `You are a legal expert specializing in e-commerce seller policies.

**TASK**: Draft comprehensive Terms of Service for an eBay seller.

**SELLER INFORMATION:**
${JSON.stringify(sellerInfo, null, 2)}

**OUTPUT FORMAT (JSON):**

\`\`\`json
{
  "returnPolicy": {
    "summary": "We accept returns within ${returnPeriod} of delivery.",
    "fullText": "Detailed return policy paragraph covering: acceptance period, condition requirements, restocking fees, return shipping costs, refund timeline, non-returnable items.",
    "keyPoints": [
      "Returns accepted within ${returnPeriod}",
      "Item must be in original condition",
      "Buyer pays return shipping unless item defective",
      "Refund processed within 3 business days of receipt"
    ]
  },

  "warranty": {
    "offered": ${warrantyOffered},
    "summary": ${
      warrantyOffered
        ? '"Limited warranty covering manufacturing defects"'
        : '"Items sold as-is with no warranty unless otherwise stated"'
    },
    "fullText": "Detailed warranty terms",
    "duration": ${warrantyOffered ? '"90 days"' : "null"}
  },

  "shippingPolicy": {
    "summary": "Fast shipping with tracking provided for all orders",
    "fullText": "Detailed shipping policy covering: handling time, carriers used, international shipping, tracking, insurance, delivery timeframes, lost package procedures.",
    "keyPoints": [
      "Ships within 1 business day",
      "Tracking number provided",
      ${
        internationalShipping
          ? '"International shipping available"'
          : '"Domestic shipping only"'
      },
      "Not responsible for carrier delays"
    ]
  },

  "disclaimers": {
    "accuracyDisclaimer": "We strive for accuracy in all listings. If you receive an item significantly different from description, contact us immediately for resolution.",
    "colorDisclaimer": "Colors may appear slightly different due to monitor settings and lighting in photos.",
    "brandDisclaimer": "Brand names are used for identification purposes only. We are not affiliated with or endorsed by mentioned brands.",
    "liabilityLimitation": "Our liability is limited to the purchase price of the item. We are not liable for indirect, incidental, or consequential damages."
  },

  "contactPolicy": {
    "summary": "Contact us through eBay messaging for all inquiries. We respond within 24 hours.",
    "fullText": "Detailed contact and customer service policy",
    "responseTime": "24 hours or less"
  },

  "disputeResolution": {
    "summary": "We encourage buyers to contact us directly before opening eBay cases. We're committed to fair resolution.",
    "fullText": "Detailed dispute resolution process and escalation procedures."
  },

  "privacyStatement": {
    "summary": "We respect your privacy. Personal information is used only for order fulfillment and is never sold to third parties.",
    "fullText": "Brief privacy policy covering data collection, usage, and protection."
  }
}
\`\`\`

**REQUIREMENTS:**
- Professional, friendly tone
- Legally sound but accessible language
- Protect seller while being fair to buyers
- eBay policy compliant
- Clear, concise bullet points
- Detailed full-text versions for legal protection

**RESPOND ONLY WITH THE JSON OBJECT. NO MARKDOWN, NO EXPLANATIONS.**`;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  async _retryWithBackoff(
    operation,
    operationName = "operation",
    correlationId = null
  ) {
    let attempt = 0;
    let delayMs = this.initialDelayMs;

    while (true) {
      attempt += 1;
      try {
        logger.debug(
          `${operationName}: attempt ${attempt}/${this.maxRetries}`,
          {
            correlationId,
          }
        );
        return await operation();
      } catch (err) {
        const isRetryable = this._isRetryableError(err);
        const isLast = attempt >= this.maxRetries;

        logger.warn(`${operationName}: attempt ${attempt} failed`, {
          correlationId,
          error: err.message,
          retryable: isRetryable,
        });

        if (!isRetryable || isLast) {
          logger.error(
            `${operationName}: giving up after ${attempt} attempts`,
            {
              correlationId,
              error: err.message,
            }
          );
          throw err;
        }

        logger.debug(`${operationName}: waiting ${delayMs}ms before retry`, {
          correlationId,
        });
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
      }
    }
  }

  _isRetryableError(error) {
    const msg = (error && error.message) || String(error || "");

    // HTTP errors
    if (
      msg.includes("503") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("504") ||
      msg.includes("429") ||
      msg.toLowerCase().includes("overloaded") ||
      msg.includes("invalid json") ||
      msg.includes("json parse") ||
      msg.toLowerCase().includes("rate limit")
    ) {
      return true;
    }

    // Network errors
    if (
      msg.toLowerCase().includes("socket") ||
      msg.toLowerCase().includes("connection") ||
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("econnreset") ||
      msg.toLowerCase().includes("enotfound")
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

  _parseJsonSafely(jsonString, correlationId) {
    try {
      return JSON.parse(jsonString);
    } catch (err) {
      logger.error("JSON parse error", {
        correlationId,
        error: err.message,
        jsonPreview: jsonString.slice(0, 1000),
      });

      // Attempt to fix common JSON issues
      try {
        // Remove trailing commas
        let fixed = jsonString.replace(/,(\s*[}\]])/g, "$1");
        // Fix unquoted keys
        fixed = fixed.replace(/(\w+):/g, '"$1":');

        return JSON.parse(fixed);
      } catch (retryErr) {
        logger.error("JSON repair attempt failed", {
          correlationId,
          error: retryErr.message,
        });
        throw new Error("AI response could not be parsed as valid JSON");
      }
    }
  }

  _validateImageInput(base64, mimeType) {
    if (!base64 || typeof base64 !== "string") {
      throw new Error("Invalid base64 string provided");
    }

    if (!this.ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error(
        `Unsupported MIME type: ${mimeType}. Allowed: ${this.ALLOWED_MIME_TYPES.join(
          ", "
        )}`
      );
    }

    // Validate base64 format
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64)) {
      throw new Error("Invalid base64 encoding format");
    }

    // Check file size
    const sizeBytes = Buffer.byteLength(base64, "base64");
    const sizeMB = sizeBytes / (1024 * 1024);

    if (sizeMB > this.MAX_IMAGE_SIZE_MB) {
      throw new Error(
        `Image size ${sizeMB.toFixed(2)}MB exceeds maximum ${
          this.MAX_IMAGE_SIZE_MB
        }MB`
      );
    }

    logger.debug("Image validation passed", {
      mimeType,
      sizeMB: sizeMB.toFixed(2),
    });
  }

  _generateCorrelationId() {
    return `gemini-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

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
        processingTime: null, // Set by caller if tracking
      },
    };
  }

  _parseFloat(value, defaultValue) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
  }
}

module.exports = new GeminiService();
