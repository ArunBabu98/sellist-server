require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const axios = require("axios");

const app = express();

// Security: Helmet sets various HTTP headers
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // For development, allow all origins
        // For production: callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Parse JSON bodies with increased limit for image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

// Stricter rate limit for token endpoints
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many token requests, please try again later",
});

// Middleware to verify API key from Flutter app
const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API key" });
  }

  next();
};

// eBay Configuration
const EBAY_CONFIG = {
  clientId: process.env.EBAY_APP_ID,
  clientSecret: process.env.EBAY_CERT_ID,
  redirectUri: process.env.EBAY_REDIRECT_URI,
  useSandbox: process.env.USE_SANDBOX === "true",

  get tokenUrl() {
    return this.useSandbox
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";
  },

  get authUrl() {
    return this.useSandbox
      ? "https://auth.sandbox.ebay.com/oauth2/authorize"
      : "https://auth.ebay.com/oauth2/authorize";
  },

  scopes: [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  ].join(" "),
};

// Validate environment variables
const validateEnv = () => {
  const required = [
    "EBAY_APP_ID",
    "EBAY_CERT_ID",
    "EBAY_REDIRECT_URI",
    "API_KEY",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
    process.exit(1);
  }
};

validateEnv();

// ═══════════════════════════════════════════════════════════════
// APPLICATION TOKEN HELPER (for Taxonomy API)
// ═══════════════════════════════════════════════════════════════
async function getApplicationToken() {
  try {
    console.log("🔐 Generating application token for Taxonomy API...");

    const credentials = Buffer.from(
      `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
    ).toString("base64");

    const response = await axios.post(
      EBAY_CONFIG.tokenUrl,
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    console.log("✅ Application token generated");
    return response.data.access_token;
  } catch (error) {
    console.error(
      "❌ Application token error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// BASIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Generate authorization URL
app.get("/api/ebay/auth-url", verifyApiKey, (req, res) => {
  try {
    const crypto = require("crypto");
    const state = crypto.randomBytes(32).toString("base64url");

    const url = new URL(EBAY_CONFIG.authUrl);
    url.searchParams.set("client_id", EBAY_CONFIG.clientId);
    url.searchParams.set("redirect_uri", EBAY_CONFIG.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", EBAY_CONFIG.scopes);
    url.searchParams.set("state", state);

    console.log("📱 Auth URL requested, state:", state);

    res.json({
      url: url.toString(),
      state: state,
    });
  } catch (error) {
    console.error("Auth URL error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange authorization code for tokens
app.post(
  "/api/ebay/exchange-token",
  verifyApiKey,
  tokenLimiter,
  async (req, res) => {
    try {
      const { code, state } = req.body;

      if (!code || !state) {
        return res.status(400).json({ error: "Code and state are required" });
      }

      console.log("🔑 Exchanging code for token, state:", state);

      const credentials = Buffer.from(
        `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
      ).toString("base64");

      const response = await axios.post(
        EBAY_CONFIG.tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: EBAY_CONFIG.redirectUri,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      console.log("✅ Token exchange successful");

      res.json({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type,
      });
    } catch (error) {
      console.error(
        "Token exchange error:",
        error.response?.data || error.message
      );

      const status = error.response?.status || 500;
      const message =
        error.response?.data?.error_description ||
        "Failed to exchange authorization code";

      res.status(status).json({ error: message });
    }
  }
);

// Refresh access token
app.post(
  "/api/ebay/refresh-token",
  verifyApiKey,
  tokenLimiter,
  async (req, res) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({ error: "Refresh token is required" });
      }

      console.log("🔄 Refreshing token");

      const credentials = Buffer.from(
        `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
      ).toString("base64");

      const response = await axios.post(
        EBAY_CONFIG.tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh_token,
          scope: EBAY_CONFIG.scopes,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      console.log("✅ Token refresh successful");

      res.json({
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type,
      });
    } catch (error) {
      console.error(
        "Token refresh error:",
        error.response?.data || error.message
      );

      const status = error.response?.status || 500;
      const message =
        error.response?.data?.error_description || "Failed to refresh token";

      res.status(status).json({ error: message });
    }
  }
);

// Get eBay user profile
app.get("/api/ebay/user-profile", verifyApiKey, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No access token provided" });
    }

    const accessToken = authHeader.substring(7);

    const identityUrl = EBAY_CONFIG.useSandbox
      ? "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/"
      : "https://apiz.ebay.com/commerce/identity/v1/user/";

    const response = await axios.get(identityUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ User profile retrieved");

    res.json(response.data);
  } catch (error) {
    console.error("User profile error:", error.response?.data || error.message);

    const status = error.response?.status || 500;
    const message =
      error.response?.data?.errors?.[0]?.message ||
      "Failed to fetch user profile";

    res.status(status).json({ error: message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TAXONOMY API ENDPOINTS (Auto-Category Detection)
// ═══════════════════════════════════════════════════════════════

// Get category suggestions using Application Token
app.post("/api/ebay/suggest-category", verifyApiKey, async (req, res) => {
  try {
    const { title, itemSpecifics } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    console.log(`🔍 Getting category suggestions for: "${title}"`);

    // Get APPLICATION token (not user token)
    const appToken = await getApplicationToken();

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

    // Call Taxonomy API with application token
    const response = await axios.get(
      `${baseUrl}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`,
      {
        params: { q: title },
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const suggestions = response.data.categorySuggestions || [];

    if (suggestions.length > 0) {
      const topCategory = suggestions[0].category;
      console.log(
        `✅ Suggested category: ${topCategory.categoryName} (${topCategory.categoryId})`
      );

      return res.json({
        categoryId: topCategory.categoryId,
        categoryName: topCategory.categoryName,
        allSuggestions: suggestions.map((s) => ({
          id: s.category.categoryId,
          name: s.category.categoryName,
        })),
      });
    }

    // Fallback
    console.log("⚠️ No suggestions found, using fallback");
    res.json({
      categoryId: "220",
      categoryName: "Toys & Hobbies",
      allSuggestions: [],
    });
  } catch (error) {
    console.error(
      "Category suggestion error:",
      error.response?.data || error.message
    );

    // Return safe default on error
    res.json({
      categoryId: "220",
      categoryName: "Toys & Hobbies",
      allSuggestions: [],
      error: error.message,
    });
  }
});

// Get category aspects using Application Token
app.get(
  "/api/ebay/category-aspects/:categoryId",
  verifyApiKey,
  async (req, res) => {
    try {
      const { categoryId } = req.params;

      console.log(`📋 Getting aspects for category: ${categoryId}`);

      // Get APPLICATION token
      const appToken = await getApplicationToken();

      const baseUrl = EBAY_CONFIG.useSandbox
        ? "https://api.sandbox.ebay.com"
        : "https://api.ebay.com";

      const response = await axios.get(
        `${baseUrl}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
        {
          params: { category_id: categoryId },
          headers: {
            Authorization: `Bearer ${appToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `✅ Got ${
          response.data.aspects?.length || 0
        } aspects for category ${categoryId}`
      );
      res.json(response.data);
    } catch (error) {
      console.error(
        "Category aspects error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to get category aspects",
        details: error.response?.data,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// LISTING MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Publish listing to eBay
app.post("/api/ebay/publish-listing", verifyApiKey, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No access token provided" });
    }

    const accessToken = authHeader.substring(7);
    let {
      sku,
      title,
      description,
      price,
      currency,
      condition,
      quantity,
      imageUrls,
      categoryId,
      itemSpecifics,
      shippingWeight,
      flaws,
      seoKeywords,
    } = req.body;

    console.log("📦 Publishing:", { sku, title, price, categoryId });

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

    // ENSURE categoryId is valid (numeric)
    if (!categoryId || !/^\d+$/.test(categoryId)) {
      console.log("⚠️ Invalid category ID, using default 220");
      categoryId = "220";
    }

    // Build product data
    const productData = {
      title: title,
      description: description,
      ...(imageUrls &&
        imageUrls.length > 0 && {
          imageUrls: imageUrls
            .filter((url) => url.startsWith("http"))
            .slice(0, 12),
        }),
    };

    // Add item specifics (aspects)
    if (itemSpecifics && Object.keys(itemSpecifics).length > 0) {
      const aspects = {};
      for (const [key, value] of Object.entries(itemSpecifics)) {
        aspects[key] = Array.isArray(value) ? value : [String(value)];
      }
      productData.aspects = aspects;
    }

    // Handle Brand/MPN for product identifiers
    if (itemSpecifics?.Brand) {
      productData.brand = itemSpecifics.Brand;
      productData.mpn = itemSpecifics?.MPN || "Does Not Apply";
    }

    if (itemSpecifics?.UPC && itemSpecifics.UPC !== "Does Not Apply") {
      productData.upc = Array.isArray(itemSpecifics.UPC)
        ? itemSpecifics.UPC
        : [itemSpecifics.UPC];
    }

    // Create inventory item
    const inventoryItemPayload = {
      availability: {
        shipToLocationAvailability: { quantity: quantity || 1 },
      },
      condition: condition || "USED_EXCELLENT",
      product: productData,
    };

    await axios.put(
      `${baseUrl}/sell/inventory/v1/inventory_item/${sku}`,
      inventoryItemPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    console.log("✅ Inventory item created");

    // Build full description with flaws
    let fullDescription = description;
    if (flaws && flaws.length > 0) {
      fullDescription += "\n\n<h3>Item Condition Notes:</h3><ul>";
      flaws.forEach((flaw) => {
        fullDescription += `<li>${flaw}</li>`;
      });
      fullDescription += "</ul>";
    }

    if (seoKeywords && seoKeywords.length > 0) {
      fullDescription += `\n\n<p><small>Keywords: ${seoKeywords.join(
        ", "
      )}</small></p>`;
    }

    // Create offer
    const offerPayload = {
      sku: sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      listingDescription: fullDescription,
      availableQuantity: quantity || 1,
      categoryId: categoryId,
      merchantLocationKey: "default_location",
      listingPolicies: {
        fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
        paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
        returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
      },
      pricingSummary: {
        price: {
          value: price.toString(),
          currency: currency || "USD",
        },
      },
    };

    if (shippingWeight) {
      offerPayload.shippingPackageDetails = {
        packageWeightAndSize: {
          weight: {
            value: parseFloat(shippingWeight) || 1,
            unit: "OUNCE",
          },
        },
      };
    }

    const offerResponse = await axios.post(
      `${baseUrl}/sell/inventory/v1/offer`,
      offerPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    const offerId = offerResponse.data.offerId;
    console.log("✅ Offer created:", offerId);

    // Publish offer
    const publishResponse = await axios.post(
      `${baseUrl}/sell/inventory/v1/offer/${offerId}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );

    const listingId = publishResponse.data.listingId;
    console.log("✅ Listing published:", listingId);

    res.json({
      success: true,
      listingId: listingId,
      offerId: offerId,
      sku: sku,
      categoryId: categoryId,
      message: "Listing published successfully",
    });
  } catch (error) {
    console.error("❌ Publish error:", error.response?.data || error.message);

    const status = error.response?.status || 500;
    const errorData = error.response?.data;

    let message = "Failed to publish listing";
    if (errorData?.errors && errorData.errors.length > 0) {
      message = errorData.errors.map((e) => e.message).join("; ");
    }

    res.status(status).json({
      error: message,
      details: errorData?.errors,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SETUP & CONFIGURATION
// ═══════════════════════════════════════════════════════════════

// Get current user's access token (for setup purposes only)
app.get("/api/ebay/get-token", verifyApiKey, (req, res) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token" });
  }
  const token = authHeader.substring(7);
  res.json({ token });
});

// Opt-in to Business Policies Management
app.post("/api/ebay/opt-in-policies", verifyApiKey, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No access token provided" });
    }

    const accessToken = authHeader.substring(7);

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

    console.log("📝 Opting in to Business Policies...");

    await axios.post(
      `${baseUrl}/sell/account/v1/program/opt_in`,
      { programType: "SELLING_POLICY_MANAGEMENT" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Successfully opted in to Business Policies");
    res.json({
      success: true,
      message: "Successfully opted in to Business Policies Management",
    });
  } catch (error) {
    console.error("Opt-in error:", error.response?.data || error.message);

    // If already opted in, that's okay
    if (error.response?.status === 409) {
      return res.json({
        success: true,
        message: "Already opted in to Business Policies",
      });
    }

    const status = error.response?.status || 500;
    res.status(status).json({
      error: "Failed to opt-in",
      details: error.response?.data,
    });
  }
});

// Create or Get Inventory Location
app.post("/api/ebay/create-location", verifyApiKey, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No access token provided" });
    }

    const accessToken = authHeader.substring(7);
    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

    const locationPayload = {
      location: {
        address: {
          addressLine1: "123 Main Street",
          city: "San Jose",
          stateOrProvince: "CA",
          postalCode: "95125",
          country: "US",
        },
      },
      locationInstructions: "Items ship from here",
      name: "Primary Location",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
    };

    console.log("📍 Creating inventory location...");

    const response = await axios.post(
      `${baseUrl}/sell/inventory/v1/location/default_location`,
      locationPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Location created: default_location");
    res.json({
      success: true,
      locationKey: "default_location",
      message: "Inventory location created successfully",
    });
  } catch (error) {
    console.error("Location error:", error.response?.data || error.message);

    // If location already exists, that's okay
    if (error.response?.status === 409) {
      return res.json({
        success: true,
        locationKey: "default_location",
        message: "Location already exists",
      });
    }

    res.status(error.response?.status || 500).json({
      error: "Failed to create location",
      details: error.response?.data,
    });
  }
});

// Upload image to eBay Media API - CORRECTED VERSION
app.post("/api/ebay/upload-image", verifyApiKey, async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No access token provided" });
    }

    const accessToken = authHeader.substring(7);
    const { imageData, filename } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: "Image data is required" });
    }

    console.log(`📸 Uploading image: ${filename || "unknown"}`);

    // Media API base URL (different from other APIs)
    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://apim.sandbox.ebay.com"
      : "https://apim.ebay.com";

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageData, "base64");
    const fileSizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);

    console.log(`📦 Image size: ${fileSizeMB} MB`);

    // Validate size (max 12 MB per eBay requirements)
    if (imageBuffer.length > 12 * 1024 * 1024) {
      return res.status(400).json({
        error: `Image too large: ${fileSizeMB} MB. Maximum is 12 MB`,
      });
    }

    // Prepare multipart/form-data (as per eBay Media API docs)
    const FormData = require("form-data");
    const form = new FormData();

    // Determine content type from filename
    const ext = (filename || "").toLowerCase();
    let contentType = "image/jpeg";
    if (ext.endsWith(".png")) contentType = "image/png";
    else if (ext.endsWith(".gif")) contentType = "image/gif";
    else if (ext.endsWith(".webp")) contentType = "image/webp";
    else if (ext.endsWith(".bmp")) contentType = "image/bmp";
    else if (ext.endsWith(".tiff") || ext.endsWith(".tif"))
      contentType = "image/tiff";
    else if (ext.endsWith(".heic")) contentType = "image/heic";
    else if (ext.endsWith(".avif")) contentType = "image/avif";

    // Key must be 'image' as per eBay documentation
    form.append("image", imageBuffer, {
      filename: filename || "image.jpg",
      contentType: contentType,
    });

    // CORRECT ENDPOINT: /commerce/media/v1_beta/image/create_image_from_file
    const endpoint = `${baseUrl}/commerce/media/v1_beta/image/create_image_from_file`;
    console.log(`🔗 Uploading to: ${endpoint}`);

    try {
      // Step 1: Upload image (returns 201 Created)
      const uploadResponse = await axios.post(endpoint, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${accessToken}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (status) => status === 201 || status === 200,
      });

      console.log(`✅ Upload response status: ${uploadResponse.status}`);

      // Step 2: Extract image ID from Location header (REQUIRED per eBay docs)
      const locationHeader = uploadResponse.headers["location"];
      let imageId = null;

      if (locationHeader) {
        // Location format: https://apim.ebay.com/commerce/media/v1_beta/image/{image_id}
        imageId = locationHeader.split("/").pop();
        console.log(`📍 Image ID from Location header: ${imageId}`);
      } else {
        console.warn("⚠️ No Location header in response");
      }

      // Step 3: Get imageUrl from response body
      let imageUrl = uploadResponse.data?.imageUrl;
      let expirationDate = uploadResponse.data?.expirationDate;

      // Step 4: If imageUrl not in response body, call getImage (as per eBay docs)
      if (!imageUrl && imageId) {
        console.log(
          `🔍 Calling getImage to retrieve imageUrl for ID: ${imageId}`
        );

        try {
          const getImageResponse = await axios.get(
            `${baseUrl}/commerce/media/v1_beta/image/${imageId}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );

          imageUrl = getImageResponse.data?.imageUrl;
          expirationDate = getImageResponse.data?.expirationDate;
          console.log(`✅ Retrieved imageUrl via getImage: ${imageUrl}`);
        } catch (getError) {
          console.error(`⚠️ Failed to get image details: ${getError.message}`);
        }
      }

      if (!imageUrl) {
        throw new Error("Failed to retrieve image URL from eBay Media API");
      }

      console.log("✅ Image uploaded successfully to eBay Picture Services");
      console.log("🖼️ Final EPS Image URL:", imageUrl);
      console.log("⏰ Expiration Date:", expirationDate);

      return res.status(201).json({
        success: true,
        imageUrl: imageUrl,
        imageId: imageId,
        expirationDate: expirationDate,
        location: locationHeader,
      });
    } catch (mediaError) {
      // Fallback to Inventory API if Media API fails (better sandbox support)
      if (
        mediaError.response?.status === 404 ||
        mediaError.response?.data?.errors?.[0]?.errorId === 2002 ||
        mediaError.code === "ENOTFOUND"
      ) {
        console.log(
          "⚠️ Media API not available, falling back to Inventory API..."
        );

        const inventoryBaseUrl = EBAY_CONFIG.useSandbox
          ? "https://api.sandbox.ebay.com"
          : "https://api.ebay.com";

        const inventoryResponse = await axios.post(
          `${inventoryBaseUrl}/sell/inventory/v1/picture`,
          imageBuffer,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/octet-stream",
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        );

        const imageUrl = inventoryResponse.data.imageUrl;
        console.log("✅ Image uploaded via Inventory API fallback:", imageUrl);

        return res.status(201).json({
          success: true,
          imageUrl: imageUrl,
          method: "inventory_api_fallback",
        });
      }

      throw mediaError;
    }
  } catch (error) {
    console.error(
      "❌ Image upload error:",
      error.response?.data || error.message
    );

    const status = error.response?.status || 500;
    const errorData = error.response?.data;

    let errorMessage = "Failed to upload image";
    if (errorData?.errors && errorData.errors.length > 0) {
      errorMessage =
        errorData.errors[0].longMessage || errorData.errors[0].message;
    }

    res.status(status).json({
      error: errorMessage,
      details: errorData,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

// Get local IP for easy mobile testing
const getLocalIP = () => {
  const os = require("os");
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
};

// Listen on all network interfaces (not just localhost)
app.listen(PORT, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Local access: http://localhost:${PORT}`);
  console.log(`📱 Network access: http://${localIP}:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `🔧 eBay Mode: ${EBAY_CONFIG.useSandbox ? "Sandbox" : "Production"}`
  );
});
