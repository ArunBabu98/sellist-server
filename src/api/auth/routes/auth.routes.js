const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../../../db/database");
const config = require("../../../config");
const { authenticate } = require("../../../middleware/auth.middleware");
const { seedFreeCredits } = require("../services/revenuecat.service");

const router = express.Router();
const SALT_ROUNDS = 12;

// POST /api/auth/signup
router.post("/signup", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = crypto.randomUUID();

    // ✅ No seedFreeCredits here — RC ID doesn't exist yet
    db.prepare("INSERT INTO users (id, email, password) VALUES (?, ?, ?)").run(
      userId,
      email.toLowerCase().trim(),
      hashed,
    );

    const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "90d" });
    res.status(201).json({ token, userId });
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "Email already registered" });
    }
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase().trim());

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
      expiresIn: "90d",
    });
    res.json({ token, userId: user.id, rc_id: user.rc_id });
  } catch (err) {
    next(err);
  }
});

// src/api/auth/routes/auth.routes.js
router.post("/link-rc", authenticate, async (req, res, next) => {
  try {
    const { rc_id } = req.body;
    console.log("🔗 link-rc called:", { rc_id, userId: req.userId });

    const user = db
      .prepare("SELECT rc_id, free_credits_seeded FROM users WHERE id = ?")
      .get(req.userId);

    console.log("👤 user from DB:", user); // ← what does this show?

    if (!user.free_credits_seeded) {
      console.log("🌱 Seeding credits for:", rc_id);
      try {
        const result = await seedFreeCredits(rc_id);
        console.log("✅ Seed result:", JSON.stringify(result));
        db.prepare(
          "UPDATE users SET rc_id = ?, free_credits_seeded = 1 WHERE id = ?",
        ).run(rc_id, req.userId);
      } catch (rcErr) {
        console.error("❌ RC seed error:", rcErr.message);
        db.prepare("UPDATE users SET rc_id = ? WHERE id = ?").run(
          rc_id,
          req.userId,
        );
      }
    } else {
      console.log(
        "⏭️ Already seeded, skipping. rc_id:",
        user.rc_id,
        "→",
        rc_id,
      );
      db.prepare("UPDATE users SET rc_id = ? WHERE id = ?").run(
        rc_id,
        req.userId,
      );
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", authenticate, (req, res, next) => {
  try {
    const user = db
      .prepare("SELECT id, email, rc_id, created_at FROM users WHERE id = ?")
      .get(req.userId);

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
