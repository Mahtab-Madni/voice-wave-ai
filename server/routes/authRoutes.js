import express from "express";
import {
  getProfile,
  signin,
  signup,
  forgotPasswordRequest,
  resetPassword,
} from "../controllers/authController.js";

const router = express.Router();
router.post("/signup", signup);
router.post("/signin", signin);
router.get("/profile", getProfile);
router.post("/forgot-password-request", forgotPasswordRequest);
router.post("/reset-password", resetPassword);

export default router;
