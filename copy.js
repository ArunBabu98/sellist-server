const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const logger = require("./logger");
const config = require("./config");

const app = express();

// Security: Helmet sets various HTTP headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        if (config.isProduction) {
          callback(new Error("Not allowed by CORS"));
        } else {
          callback(null, true);
        }
      }
    },
    credentials: true,
  })
);

// Parse JSON bodies with increased limit for image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.http({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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

  if (!apiKey || apiKey !== config.apiKey) {
    logger.warn("Unauthorized API key attempt", { ip: req.ip });
    return res.status(401).json({ error: "Unauthorized: Invalid API key" });
  }

  next();
};

// eBay Configuration
const EBAY_CONFIG = {
  clientId: config.ebay.appId,
  clientSecret: config.ebay.certId,
  redirectUri: config.ebay.redirectUri,
  useSandbox: config.ebay.useSandbox,

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

// ═══════════════════════════════════════════════════════════════
// APPLICATION TOKEN HELPER (for Taxonomy API)
// ═══════════════════════════════════════════════════════════════
async function getApplicationToken() {
  try {
    logger.debug("Generating application token for Taxonomy API");

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

    logger.debug("Application token generated successfully");
    return response.data.access_token;
  } catch (error) {
    logger.error("Application token generation failed", {
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// BASIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
  });
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

    logger.info("Auth URL requested", { state });

    res.json({
      url: url.toString(),
      state: state,
    });
  } catch (error) {
    logger.error("Auth URL generation failed", { error: error.message });
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

      logger.info("Exchanging authorization code", { state });

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

      logger.info("Token exchange successful");

      res.json({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type,
      });
    } catch (error) {
      logger.error("Token exchange failed", {
        error: error.message,
        status: error.response?.status,
      });

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

      logger.info("Refreshing access token");

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

      logger.info("Token refresh successful");

      res.json({
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        token_type: response.data.token_type,
      });
    } catch (error) {
      logger.error("Token refresh failed", {
        error: error.message,
        status: error.response?.status,
      });

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

    logger.info("User profile retrieved successfully");

    res.json(response.data);
  } catch (error) {
    logger.error("User profile retrieval failed", {
      error: error.message,
      status: error.response?.status,
    });

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

    logger.info("Getting category suggestions", { title });

    const appToken = await getApplicationToken();

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

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
      logger.info("Category suggestion found", {
        categoryId: topCategory.categoryId,
        categoryName: topCategory.categoryName,
      });

      return res.json({
        categoryId: topCategory.categoryId,
        categoryName: topCategory.categoryName,
        allSuggestions: suggestions.map((s) => ({
          id: s.category.categoryId,
          name: s.category.categoryName,
        })),
      });
    }

    logger.warn("No category suggestions found, using fallback");
    res.json({
      categoryId: "220",
      categoryName: "Toys & Hobbies",
      allSuggestions: [],
    });
  } catch (error) {
    logger.error("Category suggestion failed", { error: error.message });
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

      logger.info("Getting category aspects", { categoryId });

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

      logger.info("Category aspects retrieved", {
        categoryId,
        aspectCount: response.data.aspects?.length || 0,
      });

      res.json(response.data);
    } catch (error) {
      logger.error("Category aspects retrieval failed", {
        error: error.message,
      });
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

    logger.info("Publishing listing", { sku, title, price, categoryId });

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

    if (!categoryId || !/^\d+$/.test(categoryId)) {
      logger.warn("Invalid category ID, using default 220");
      categoryId = "220";
    }

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

    if (itemSpecifics && Object.keys(itemSpecifics).length > 0) {
      const aspects = {};
      for (const [key, value] of Object.entries(itemSpecifics)) {
        aspects[key] = Array.isArray(value) ? value : [String(value)];
      }
      productData.aspects = aspects;
    }

    if (itemSpecifics?.Brand) {
      productData.brand = itemSpecifics.Brand;
      productData.mpn = itemSpecifics?.MPN || "Does Not Apply";
    }

    if (itemSpecifics?.UPC && itemSpecifics.UPC !== "Does Not Apply") {
      productData.upc = Array.isArray(itemSpecifics.UPC)
        ? itemSpecifics.UPC
        : [itemSpecifics.UPC];
    }

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

    logger.info("Inventory item created", { sku });

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

    const offerPayload = {
      sku: sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      listingDescription: fullDescription,
      availableQuantity: quantity || 1,
      categoryId: categoryId,
      merchantLocationKey: "default_location",
      listingPolicies: {
        fulfillmentPolicyId: config.ebay.fulfillmentPolicyId,
        paymentPolicyId: config.ebay.paymentPolicyId,
        returnPolicyId: config.ebay.returnPolicyId,
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
    logger.info("Offer created", { offerId });

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
    logger.info("Listing published successfully", { listingId, sku });

    res.json({
      success: true,
      listingId: listingId,
      offerId: offerId,
      sku: sku,
      categoryId: categoryId,
      message: "Listing published successfully",
    });
  } catch (error) {
    logger.error("Publish listing failed", {
      error: error.message,
      status: error.response?.status,
    });

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

    logger.info("Opting in to Business Policies");

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

    logger.info("Successfully opted in to Business Policies");
    res.json({
      success: true,
      message: "Successfully opted in to Business Policies Management",
    });
  } catch (error) {
    logger.error("Opt-in failed", { error: error.message });

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

    logger.info("Creating inventory location");

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

    logger.info("Location created successfully");
    res.json({
      success: true,
      locationKey: "default_location",
      message: "Inventory location created successfully",
    });
  } catch (error) {
    logger.error("Location creation failed", { error: error.message });

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

// Upload image to eBay Media API
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

    logger.info("Uploading image", { filename });

    const baseUrl = EBAY_CONFIG.useSandbox
      ? "https://apim.sandbox.ebay.com"
      : "https://apim.ebay.com";

    const imageBuffer = Buffer.from(imageData, "base64");
    const fileSizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);

    logger.debug("Image size", { sizeMB: fileSizeMB });

    if (imageBuffer.length > 12 * 1024 * 1024) {
      return res.status(400).json({
        error: `Image too large: ${fileSizeMB} MB. Maximum is 12 MB`,
      });
    }

    const FormData = require("form-data");
    const form = new FormData();

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

    form.append("image", imageBuffer, {
      filename: filename || "image.jpg",
      contentType: contentType,
    });

    const endpoint = `${baseUrl}/commerce/media/v1_beta/image/create_image_from_file`;

    try {
      const uploadResponse = await axios.post(endpoint, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${accessToken}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (status) => status === 201 || status === 200,
      });

      const locationHeader = uploadResponse.headers["location"];
      let imageId = null;

      if (locationHeader) {
        imageId = locationHeader.split("/").pop();
        logger.debug("Image ID from Location header", { imageId });
      }

      let imageUrl = uploadResponse.data?.imageUrl;
      let expirationDate = uploadResponse.data?.expirationDate;

      if (!imageUrl && imageId) {
        logger.debug("Calling getImage to retrieve imageUrl");

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
        } catch (getError) {
          logger.warn("Failed to get image details", {
            error: getError.message,
          });
        }
      }

      if (!imageUrl) {
        throw new Error("Failed to retrieve image URL from eBay Media API");
      }

      logger.info("Image uploaded successfully", { imageUrl });

      return res.status(201).json({
        success: true,
        imageUrl: imageUrl,
        imageId: imageId,
        expirationDate: expirationDate,
        location: locationHeader,
      });
    } catch (mediaError) {
      if (
        mediaError.response?.status === 404 ||
        mediaError.response?.data?.errors?.[0]?.errorId === 2002 ||
        mediaError.code === "ENOTFOUND"
      ) {
        logger.warn("Media API not available, falling back to Inventory API");

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
        logger.info("Image uploaded via Inventory API fallback", { imageUrl });

        return res.status(201).json({
          success: true,
          imageUrl: imageUrl,
          method: "inventory_api_fallback",
        });
      }

      throw mediaError;
    }
  } catch (error) {
    logger.error("Image upload failed", {
      error: error.message,
      status: error.response?.status,
    });

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

app.use((err, req, res, next) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: config.isDevelopment ? err.stack : undefined,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: config.isProduction ? "Internal server error" : err.message,
  });
});

app.use((req, res) => {
  logger.warn("Route not found", { url: req.url, method: req.method });
  res.status(404).json({ error: "Not found" });
});

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════

let server;

function gracefulShutdown(signal) {
  logger.info(`${signal} received, starting graceful shutdown`);

  if (server) {
    server.close((err) => {
      if (err) {
        logger.error("Error during server shutdown", { error: err.message });
        process.exit(1);
      }

      logger.info("HTTP server closed");
      logger.info("Graceful shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

const getLocalIP = () => {
  const os = require("os");
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
};

server = app.listen(config.port, "0.0.0.0", () => {
  const localIP = getLocalIP();
  logger.info("Server started", {
    port: config.port,
    environment: config.nodeEnv,
    ebayMode: EBAY_CONFIG.useSandbox ? "Sandbox" : "Production",
    localUrl: `http://localhost:${config.port}`,
    networkUrl: `http://${localIP}:${config.port}`,
  });
});

module.exports = app;
