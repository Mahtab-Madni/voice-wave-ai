import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { sendResetLinkEmail } from "../services/sendResetLinkEmail.js";

const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET || "dev-secret",
    {
      expiresIn: "7d",
    },
  );

export const validatePasswordStrength = (password) => {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must include at least one letter.";
  }
  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }
  return "";
};

export const signup = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, company } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Email and password are required." });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ ok: false, message: passwordError });
    }

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ ok: false, message: "Passwords do not match." });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res
        .status(409)
        .json({ ok: false, message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name || "Developer",
      email: email.toLowerCase(),
      password: hashedPassword,
      company: company || "",
    });

    return res.status(201).json({
      ok: true,
      token: signToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const signin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, message: "Invalid credentials." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res
        .status(401)
        .json({ ok: false, message: "Invalid credentials." });
    }

    return res.json({
      ok: true,
      token: signToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ ok: false, message: "Missing token." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found." });
    }

    return res.json({
      ok: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
      },
    });
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res
        .status(401)
        .json({ ok: false, message: "Invalid or expired token." });
    }

    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const buildResetPasswordUrl = (
  token,
  frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173",
) => {
  const baseUrl = String(frontendUrl || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
  return `${baseUrl}/forgot?token=${encodeURIComponent(token)}`;
};

export const resolveResetPasswordInput = (body = {}) => ({
  token: body?.token,
  newPassword: body?.newPassword ?? body?.password,
});

export const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ ok: false, message: "Email is required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(404)
        .json({ ok: false, message: "User with this email does not exist." });
    }

    const resetToken = await user.createPasswordResetToken();
    const resetUrl = buildResetPasswordUrl(
      resetToken,
      process.env.FRONTEND_URL || "http://localhost:5173",
    );
    try {
      await sendResetLinkEmail(user.email, resetUrl, user.name);

      res.status(200).json({
        ok: true,
        message: "Password reset link sent to your email",
      });
    } catch (emailError) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error("Email sending failed:", emailError);
      return res.status(500).json({
        ok: false,
        message: "Failed to send password reset email. Please try again later.",
      });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = resolveResetPasswordInput(req.body);

    if (!token || !newPassword) {
      return res.status(400).json({
        ok: false,
        message: "Token and new password are required",
      });
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return res.status(400).json({ ok: false, message: passwordError });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        ok: false,
        message: "Invalid or expired reset token",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({
      ok: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error. Please try again later." });
  }
};
