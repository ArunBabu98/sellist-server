const axios = require("axios");
const FormData = require("form-data");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MediaService {
  async uploadImage(accessToken, imageBuffer, filename) {
    const maxAttempts = 5; // ✅ Increased to 5 for better 503 handling

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info("Uploading image via eBay Media API", {
          filename,
          attempt,
          maxAttempts,
        });

        return await this._uploadViaMediaApi(
          accessToken,
          imageBuffer,
          filename,
        );
      } catch (err) {
        const status = err.response?.status;
        const isLastAttempt = attempt === maxAttempts;

        logger.warn("Media API upload attempt failed", {
          filename,
          attempt,
          maxAttempts,
          status,
          error: err.message,
        });

        if (isLastAttempt || !this._isRetryable(err)) {
          logger.error("Image upload failed permanently", {
            filename,
            attempts: attempt,
            status,
          });
          throw err;
        }

        // ✅ Exponential backoff with jitter
        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        const jitter = Math.random() * 1000; // ✅ Added jitter
        const delay = baseDelay + jitter;

        logger.info("Retrying image upload", {
          filename,
          nextAttempt: attempt + 1,
          delayMs: Math.round(delay),
        });

        await sleep(delay);
      }
    }

    throw new Error("Image upload failed after all retry attempts");
  }

  /* ───────────────────────────────────────────── */

  async _uploadViaMediaApi(accessToken, imageBuffer, filename) {
    const form = new FormData();

    form.append("image", imageBuffer, {
      filename: filename || "image.jpg",
      contentType: this._detectContentType(filename),
    });

    const endpoint = `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/create_image_from_file`;

    const response = await axios.post(endpoint, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000, // ✅ 30 second timeout
      validateStatus: (s) => s === 200 || s === 201,
    });

    const location = response.headers["location"];
    if (!location) {
      throw new Error("Media API response missing Location header");
    }

    const imageId = location.split("/").pop();

    logger.debug("Media API image created", { imageId });

    // ✅ Fetch metadata with retry
    const meta = await this._getImageMetadata(accessToken, imageId);

    const imageUrl = meta.data?.imageUrl;
    const expirationDate = meta.data?.expirationDate;

    if (!imageUrl) {
      throw new Error("Media API getImage returned no imageUrl");
    }

    return {
      success: true,
      imageId,
      imageUrl,
      expirationDate,
      method: "media_api",
    };
  }

  /* ───────────────────────────────────────────── */

  /**
   * ✅ NEW: Fetch metadata with retry
   * Sometimes upload succeeds but metadata fetch fails
   */
  async _getImageMetadata(accessToken, imageId, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await axios.get(
          `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/${imageId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
            timeout: 10000, // ✅ 10 second timeout
          },
        );
      } catch (err) {
        if (attempt === maxAttempts) {
          logger.error("Failed to fetch image metadata", {
            imageId,
            attempts: maxAttempts,
            error: err.message,
          });
          throw err;
        }

        logger.warn("Metadata fetch failed, retrying", {
          imageId,
          attempt,
          nextAttempt: attempt + 1,
        });

        await sleep(500 * attempt);
      }
    }
  }

  /* ───────────────────────────────────────────── */

  _isRetryable(err) {
    const status = err.response?.status;

    return (
      status === 429 || // rate limit
      status === 500 ||
      status === 502 ||
      status === 503 || // ✅ Your main issue
      status === 504 ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNREFUSED" // ✅ Added this
    );
  }

  _detectContentType(filename = "") {
    const ext = filename.toLowerCase();
    if (ext.endsWith(".png")) return "image/png";
    if (ext.endsWith(".gif")) return "image/gif";
    if (ext.endsWith(".webp")) return "image/webp";
    if (ext.endsWith(".bmp")) return "image/bmp";
    if (ext.endsWith(".tiff") || ext.endsWith(".tif")) return "image/tiff";
    if (ext.endsWith(".heic")) return "image/heic";
    if (ext.endsWith(".avif")) return "image/avif";
    return "image/jpeg";
  }
}

module.exports = new MediaService();
