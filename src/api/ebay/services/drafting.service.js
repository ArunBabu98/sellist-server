const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");

class DraftingService {
  /**
   * Create drafts using BULK APIs (25 max per batch)
   */
  async batchCreateDrafts(accessToken, drafts) {
    logger.info("DraftingService.batchCreateDrafts:start", {
      totalDrafts: drafts.length,
      batchSize: 25,
    });

    const results = [];

    // Chunk drafts into batches of 25
    for (let i = 0; i < drafts.length; i += 25) {
      const chunk = drafts.slice(i, i + 25);

      logger.debug("DraftingService.batch:start", {
        batchIndex: i / 25,
        batchStart: i,
        batchCount: chunk.length,
        skus: chunk.map((d) => d.sku),
      });

      try {
        // 1️⃣ Bulk inventory items
        logger.debug("DraftingService.inventory:request", {
          endpoint: "/sell/inventory/v1/bulk_create_or_replace_inventory_item",
          count: chunk.length,
        });

        await axios.post(
          `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/bulk_create_or_replace_inventory_item`,
          {
            requests: chunk.map((d) => ({
              sku: d.sku,
              ...d.inventoryItem,
            })),
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        logger.info("DraftingService.inventory:success", {
          batchIndex: i / 25,
          count: chunk.length,
        });

        // 2️⃣ Bulk offers (drafts)
        logger.debug("DraftingService.offers:request", {
          endpoint: "/sell/inventory/v1/bulk_create_offer",
          count: chunk.length,
        });

        const offerRes = await axios.post(
          `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/bulk_create_offer`,
          {
            requests: chunk.map((d) => d.offer),
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        logger.debug("DraftingService.offers:response", {
          responses: offerRes.data.responses?.length,
        });

        offerRes.data.responses.forEach((r, idx) => {
          const success = r.statusCode < 300;

          logger.debug("DraftingService.offer:result", {
            sku: chunk[idx].sku,
            statusCode: r.statusCode,
            offerId: r.offerId,
            success,
          });

          results.push({
            success,
            sku: chunk[idx].sku,
            offerId: r.offerId,
            error: success ? undefined : r.errors,
          });
        });
      } catch (err) {
        logger.error("DraftingService.batch:error", {
          batchIndex: i / 25,
          batchStart: i,
          skus: chunk.map((d) => d.sku),
          error: err.response?.data || err.message,
        });

        chunk.forEach((d) =>
          results.push({
            success: false,
            sku: d.sku,
            error: "Batch failed",
          })
        );
      }
    }

    logger.info("DraftingService.batchCreateDrafts:complete", {
      total: drafts.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    });

    return results;
  }

  /**
   * Fetch draft offers from eBay
   */
  async getDraftOffers(accessToken, { limit = 200, offset = 0 }) {
    logger.debug("DraftingService.getDraftOffers:start", {
      limit,
      offset,
    });

    const res = await axios.get(
      `${EBAY_CONFIG.baseUrl}/sell/inventory/v1/offer`,
      {
        params: { limit, offset },
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const offers = res.data.offers || [];
    const drafts = offers.filter((o) => o.status === "DRAFT");

    logger.info("DraftingService.getDraftOffers:complete", {
      fetched: offers.length,
      drafts: drafts.length,
    });

    return drafts;
  }
}

module.exports = new DraftingService();
