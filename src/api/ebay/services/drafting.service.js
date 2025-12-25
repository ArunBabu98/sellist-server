const axios = require("axios");
const EBAY_CONFIG = require("../../../config/ebay.config");
const logger = require("../../../config/logger.config");
const taxonomyService = require("./taxonomy.service");

class DraftingService {
  /**
   * Create drafts using BULK APIs (25 max per batch)
   * Inventory + Draft Offer
   */
  async batchCreateDrafts(accessToken, drafts) {
    logger.info("DraftingService.batchCreateDrafts:start", {
      totalDrafts: drafts.length,
      batchSize: 25,
    });

    const results = [];

    // Process in batches of 25
    for (let i = 0; i < drafts.length; i += 25) {
      const chunk = drafts.slice(i, i + 25);

      logger.debug("DraftingService.batch:start", {
        batchIndex: i / 25,
        batchStart: i,
        batchCount: chunk.length,
        skus: chunk.map((d) => d.sku),
      });

      try {
        // ─────────────────────────────────────────────
        // 0️⃣ ENSURE VALID LEAF CATEGORY (SERVER SIDE)
        // ─────────────────────────────────────────────
        for (const draft of chunk) {
          let categoryId = draft.offer?.categoryId;

          if (!categoryId || !/^\d+$/.test(categoryId)) {
            const title =
              draft.inventoryItem?.product?.title || "Unknown Product";

            logger.info("Resolving category on server", {
              sku: draft.sku,
              title,
            });

            const resolved = await taxonomyService.suggestCategory(title);

            draft.offer.categoryId = resolved.categoryId;

            logger.info("Category resolved", {
              sku: draft.sku,
              parentCategoryId: resolved.parentCategoryId,
              leafCategoryId: resolved.categoryId,
            });
          }
        }

        // ─────────────────────────────────────────────
        // 1️⃣ BULK INVENTORY ITEMS
        // ─────────────────────────────────────────────
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
              "Content-Type": "application/json",
              "Content-Language": "en-US",
            },
          }
        );

        logger.info("DraftingService.inventory:success", {
          batchIndex: i / 25,
          count: chunk.length,
        });

        // ─────────────────────────────────────────────
        // 2️⃣ BULK DRAFT OFFERS
        // ─────────────────────────────────────────────
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
              "Content-Type": "application/json",
              "Content-Language": "en-US",
            },
          }
        );

        logger.debug("DraftingService.offers:response", {
          responses: offerRes.data.responses?.length,
        });

        offerRes.data.responses.forEach((r, idx) => {
          const success = r.statusCode < 300;

          results.push({
            success,
            sku: chunk[idx].sku,
            offerId: r.offerId,
            error: success ? undefined : r.errors,
          });

          logger.debug("DraftingService.offer:result", {
            sku: chunk[idx].sku,
            statusCode: r.statusCode,
            offerId: r.offerId,
            success,
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
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
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
