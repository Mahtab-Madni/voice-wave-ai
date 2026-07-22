import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET || "dev-secret",
    {
      expiresIn: "7d",
    },
  );

export const signup = async (req, res) => {
  try {
    const { name, email, password, company } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Email and password are required." });
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
