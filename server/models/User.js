import crypto from "crypto";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    company: { type: String, default: "" },
    role: { type: String, default: "developer" },
    projects: [{ type: mongoose.Schema.Types.ObjectId, ref: "Project" }],
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.createPasswordResetToken = async function () {
  // Generate random token
  const resetToken = crypto.randomBytes(32).toString("hex");

  // Hash token and save to database
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  // Set expiration time (1 hour from now)
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour

  await this.save({ validateBeforeSave: false });

  // Return unhashed token to send via email
  return resetToken;
};

export default mongoose.model("User", userSchema);
