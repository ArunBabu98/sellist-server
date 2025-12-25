const draftingService = require("../services/drafting.service");
const logger = require("../../../config/logger.config");

/**
 * Drafting Controller
 * Handles draft-only listing creation and retrieval
 */
class DraftingController {
  /**
   * Create drafts in bulk (Inventory + Offer, NOT published)
   *
   * Expected body:
   * {
   *   drafts: [
   *     {
   *       sku: "SKU123",
   *       inventoryItem: { ... },
   *       offer: { ... }
   *     }
   *   ]
   * }
   */
  async batchCreateDrafts(req, res) {
    logger.info("DraftingController.batchCreateDrafts:request", {
      draftCount: req.body?.drafts?.length,
      skus: req.body?.drafts?.map((d) => d.sku),
    });

    try {
      const accessToken = req.accessToken;
      const { drafts } = req.body;

      if (!Array.isArray(drafts) || drafts.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Drafts array is required",
        });
      }

      // Basic validation (cheap & fast)
      for (const d of drafts) {
        if (!d.sku || !d.inventoryItem || !d.offer) {
          return res.status(400).json({
            success: false,
            error: "Each draft must contain sku, inventoryItem, and offer",
          });
        }
      }

      logger.info("Starting batch draft creation", {
        count: drafts.length,
      });

      const results = await draftingService.batchCreateDrafts(
        accessToken,
        drafts
      );
      logger.info("DraftingController.batchCreateDrafts:response", {
        results,
      });

      return res.json({
        success: true,
        data: results,
        meta: {
          requested: drafts.length,
          succeeded: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      });
    } catch (err) {
      logger.error("Batch draft creation failed", {
        error: err.response?.data || err.message,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to create drafts",
        details: err.response?.data || err.message,
      });
    }
  }

  /**
   * Retrieve draft offers from eBay
   * Query params:
   *   limit (default 200)
   *   offset (default 0)
   */
  async getDraftOffers(req, res) {
    try {
      const accessToken = req.accessToken;
      const limit = parseInt(req.query.limit || "200", 10);
      const offset = parseInt(req.query.offset || "0", 10);

      const drafts = await draftingService.getDraftOffers(accessToken, {
        limit,
        offset,
      });

      return res.json({
        success: true,
        data: drafts,
        meta: {
          count: drafts.length,
          limit,
          offset,
        },
      });
    } catch (err) {
      logger.error("Failed to fetch draft offers", {
        error: err.response?.data || err.message,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to retrieve draft offers",
        details: err.response?.data || err.message,
      });
    }
  }
}

module.exports = new DraftingController();
