const axios = require("axios");
const FormData = require("form-data");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MediaService {
  async uploadImage(accessToken, imageBuffer, filename) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info("Uploading image via eBay Media API", {
          filename,
          attempt,
        });

        return await this._uploadViaMediaApi(
          accessToken,
          imageBuffer,
          filename
        );
      } catch (err) {
        const status = err.response?.status;

        logger.warn("Media API upload attempt failed", {
          filename,
          attempt,
          status,
          error: err.message,
        });

        if (attempt < maxAttempts && this._isRetryable(err)) {
          await sleep(500 * Math.pow(2, attempt)); // 1s → 2s → 4s
          continue;
        }

        throw err;
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
      validateStatus: (s) => s === 200 || s === 201,
    });

    const location = response.headers["location"];
    if (!location) {
      throw new Error("Media API response missing Location header");
    }

    const imageId = location.split("/").pop();

    logger.debug("Media API image created", { imageId });

    // Official flow: fetch image metadata
    const meta = await axios.get(
      `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/${imageId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

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

  _isRetryable(err) {
    const status = err.response?.status;

    return (
      status === 429 || // rate limit
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT"
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
