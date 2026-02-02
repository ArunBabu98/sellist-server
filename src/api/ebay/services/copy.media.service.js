// const axios = require("axios");
// const FormData = require("form-data");
// const EBAY_CONFIG = require("../../../config/ebay.config");
// const logger = require("../../../config/logger.config");

// const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// class MediaService {
//   async uploadImage(accessToken, imageBuffer, filename) {
//     const maxAttempts = 3;

//     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//       try {
//         logger.info("Uploading image via eBay Media API", {
//           filename,
//           attempt,
//         });

//         return await this._uploadViaMediaApi(
//           accessToken,
//           imageBuffer,
//           filename
//         );
//       } catch (err) {
//         const status = err.response?.status;

//         logger.warn("Media API upload attempt failed", {
//           filename,
//           attempt,
//           status,
//           error: err.message,
//         });

//         // If it's a 503 and we've exhausted retries, move to Fallback
//         if (attempt === maxAttempts || !this._isRetryable(err)) {
//           if (status === 503 || status === 500) {
//             logger.info(
//               "Switching to Temporary Fallback Hosting due to eBay 503",
//               { filename }
//             );
//             return await this._uploadToFallback(imageBuffer, filename);
//           }
//           throw err;
//         }

//         await sleep(500 * Math.pow(2, attempt));
//         continue;
//       }
//     }
//   }

//   /**
//    * FALLBACK: Uploads to a temporary hosting service when eBay is down
//    * Using ImgBB as an example (Free, no account required for small scale, or use your API key)
//    */
//   async _uploadToFallback(imageBuffer, filename) {
//     try {
//       const form = new FormData();
//       // ImgBB API key is free at https://api.imgbb.com/
//       const apiKey = process.env.IMGBB_API_KEY;

//       form.append("image", imageBuffer.toString("base64"));

//       const response = await axios.post(
//         `https://api.imgbb.com/1/upload?key=${apiKey}`,
//         form
//       );

//       const imageUrl = response.data?.data?.url;

//       if (!imageUrl) throw new Error("Fallback hosting failed to return URL");

//       return {
//         success: true,
//         imageId: null, // No eBay ID yet
//         imageUrl: imageUrl,
//         method: "fallback_temporary",
//         note: "eBay Media API was unavailable; used temporary hosting.",
//       };
//     } catch (fallbackErr) {
//       logger.error("Fallback hosting also failed", {
//         error: fallbackErr.message,
//       });
//       throw new Error("Both eBay and Fallback hosting failed.");
//     }
//   }

//   /* ─── EXISTING EBAY LOGIC ─── */

//   async _uploadViaMediaApi(accessToken, imageBuffer, filename) {
//     const form = new FormData();
//     form.append("image", imageBuffer, {
//       filename: filename || "image.jpg",
//       contentType: this._detectContentType(filename),
//     });

//     const endpoint = `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/create_image_from_file`;

//     const response = await axios.post(endpoint, form, {
//       headers: {
//         ...form.getHeaders(),
//         Authorization: `Bearer ${accessToken}`,
//         Accept: "application/json",
//       },
//       maxBodyLength: Infinity,
//       maxContentLength: Infinity,
//       validateStatus: (s) => s === 200 || s === 201,
//     });

//     const location = response.headers["location"];
//     if (!location)
//       throw new Error("Media API response missing Location header");

//     const imageId = location.split("/").pop();

//     const meta = await axios.get(
//       `${EBAY_CONFIG.mediaBaseUrl}/commerce/media/v1_beta/image/${imageId}`,
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//           Accept: "application/json",
//         },
//       }
//     );

//     return {
//       success: true,
//       imageId,
//       imageUrl: meta.data?.imageUrl,
//       expirationDate: meta.data?.expirationDate,
//       method: "media_api",
//     };
//   }

//   _isRetryable(err) {
//     const status = err.response?.status;
//     return (
//       status === 429 ||
//       status >= 500 ||
//       err.code === "ECONNRESET" ||
//       err.code === "ETIMEDOUT"
//     );
//   }

//   _detectContentType(filename = "") {
//     const ext = filename.toLowerCase();
//     if (ext.endsWith(".png")) return "image/png";
//     if (ext.endsWith(".webp")) return "image/webp";
//     return "image/jpeg";
//   }
// }

// module.exports = new MediaService();
