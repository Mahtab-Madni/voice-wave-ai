import express from "express";
import { getProfile, signin, signup } from "../controllers/authController.js";

const router = express.Router();
router.post("/signup", signup);
router.post("/signin", signin);
router.get("/profile", getProfile);

export default router;
