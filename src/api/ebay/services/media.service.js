const axios = require("axios");
const FormData = require("form-data");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

class MediaService {
  async uploadImage(accessToken, imageBuffer, filename) {
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

    const endpoint = `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/create_image_from_file`;

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
            `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/${imageId}`,
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

      return {
        success: true,
        imageUrl: imageUrl,
        imageId: imageId,
        expirationDate: expirationDate,
        location: locationHeader,
      };
    } catch (mediaError) {
      if (
        mediaError.response?.status === 404 ||
        mediaError.response?.data?.errors?.[0]?.errorId === 2002 ||
        mediaError.code === "ENOTFOUND"
      ) {
        logger.warn("Media API not available, falling back to Inventory API");

        const inventoryResponse = await axios.post(
          `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/picture`,
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

        return {
          success: true,
          imageUrl: imageUrl,
          method: "inventory_api_fallback",
        };
      }

      throw mediaError;
    }
  }
}

module.exports = new MediaService();
