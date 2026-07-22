import express from "express";
import {
  getLiveUsers,
  getTotalVisitors,
  incrementViews,
} from "../controllers/statsController.js";

const router = express.Router();

router.get("/stats/live-users", getLiveUsers);
router.get("/stats/total-visitors", getTotalVisitors);
router.post("/stats/increment-views", incrementViews);

export default router;
