const axios = require("axios");
const crypto = require("crypto");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

class AuthService {
  generateAuthUrl() {
    const state = crypto.randomBytes(32).toString("base64url");

    logger.debug("Generating auth URL", {
      clientId: EBAY_CONFIG.clientId?.substring(0, 15) + "...",
      redirectUri: EBAY_CONFIG.redirectUri,
      sandbox: EBAY_CONFIG.useSandbox,
    });

    const url = new URL(EBAY_CONFIG.authUrl);
    url.searchParams.set("client_id", EBAY_CONFIG.clientId);
    url.searchParams.set("redirect_uri", EBAY_CONFIG.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", EBAY_CONFIG.scopes);
    url.searchParams.set("state", state);

    return {
      url: url.toString(),
      state: state,
    };
  }

  async exchangeToken(code) {
    logger.info("🔄 Starting token exchange", {
      clientId: EBAY_CONFIG.clientId?.substring(0, 20) + "...",
      hasClientSecret: !!EBAY_CONFIG.clientSecret,
      clientSecretLength: EBAY_CONFIG.clientSecret?.length,
      redirectUri: EBAY_CONFIG.redirectUri,
      tokenUrl: EBAY_CONFIG.tokenUrl,
      useSandbox: EBAY_CONFIG.useSandbox,
      codeLength: code?.length,
      codePreview: code?.substring(0, 20) + "...",
    });

    const credentials = Buffer.from(
      `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
    ).toString("base64");

    logger.debug("Request details:", {
      url: EBAY_CONFIG.tokenUrl,
      authHeaderLength: credentials.length,
      redirectUri: EBAY_CONFIG.redirectUri,
    });

    try {
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
          timeout: 30000,
          validateStatus: (status) => status < 500, // Don't throw on 4xx
        }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info("✅ Token exchange successful");
        return {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_in: response.data.expires_in,
          token_type: response.data.token_type,
        };
      } else {
        logger.error("❌ eBay returned error:", {
          status: response.status,
          data: response.data,
        });
        const error = new Error(
          response.data.error_description ||
            response.data.error ||
            "Token exchange failed"
        );
        error.response = response;
        throw error;
      }
    } catch (error) {
      if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        logger.error("❌ Network error:", {
          code: error.code,
          message: error.message,
          url: EBAY_CONFIG.tokenUrl,
        });
      } else if (error.code === "ECONNREFUSED") {
        logger.error("❌ Connection refused:", {
          message: "Cannot connect to eBay API",
          url: EBAY_CONFIG.tokenUrl,
        });
      } else {
        logger.error("❌ Token exchange failed:", {
          status: error.response?.status,
          statusText: error.response?.statusText,
          errorData: error.response?.data,
          errorCode: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  async refreshToken(refreshToken) {
    logger.info("Refreshing access token");

    const credentials = Buffer.from(
      `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
    ).toString("base64");

    const response = await axios.post(
      EBAY_CONFIG.tokenUrl,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_CONFIG.scopes,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        timeout: 30000,
      }
    );

    return {
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
      token_type: response.data.token_type,
    };
  }

  isRetryableIdentityError(error) {
    const status = error.response?.status;

    // Network issues
    if (!status && error.code) return true;

    // Transient eBay issues
    if ([429, 500, 502, 503, 504].includes(status)) return true;

    return false;
  }

  backoffDelay(attempt) {
    const base = Math.min(1000 * Math.pow(2, attempt), 15000); // cap at 15s
    const jitter = Math.random() * 500;
    return base + jitter;
  }

  async getUserProfile(accessToken, options = {}) {
    const {
      maxAttempts = 5,
      context = "login", // login | refresh | background
    } = options;

    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
      try {
        const response = await axios.get(EBAY_CONFIG.identityUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        if (!response.data?.userId) {
          throw new Error("Identity response missing userId");
        }

        logger.info("✅ eBay identity verified", {
          ebayUserId: response.data.userId,
          attempt: attempt + 1,
          context,
        });

        return response.data;
      } catch (error) {
        lastError = error;

        const status = error.response?.status;

        logger.warn("⚠️ Identity fetch failed", {
          attempt: attempt + 1,
          maxAttempts,
          status,
          code: error.code,
          context,
          message: error.message,
        });

        // ✅ FIXED
        if (!this.isRetryableIdentityError(error)) {
          break;
        }

        if (context === "background" && attempt >= 1) {
          break;
        }

        const delay = this.backoffDelay(attempt); // ✅ FIXED
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }

    logger.error("❌ Identity verification failed after retries", {
      attempts: attempt,
      context,
      lastStatus: lastError?.response?.status,
      lastMessage: lastError?.message,
    });

    throw lastError;
  }

  async getApplicationToken() {
    logger.debug("Generating application token");

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
        timeout: 30000,
      }
    );

    return response.data.access_token;
  }
}

module.exports = new AuthService();
