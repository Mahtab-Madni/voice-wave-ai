import express from "express";
import {
  getOverviewMetrics,
  getProjectMetrics,
} from "../controllers/metricesController.js";
import jwt from "jsonwebtoken";

const router = express.Router();

const requireAuth = (req, _res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return _res
      .status(401)
      .json({ ok: false, message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    req.user = { id: decoded?.id || null };
    return next();
  } catch {
    return _res
      .status(401)
      .json({ ok: false, message: "Invalid or expired token." });
  }
};

// GET /api/metrics/overview
router.get("/metrics/overview", requireAuth, getOverviewMetrics);
router.get("/projects/:id/metrics", requireAuth, getProjectMetrics);

export default router;
