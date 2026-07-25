import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResetPasswordUrl,
  resolveResetPasswordInput,
  validatePasswordStrength,
} from "../server/controllers/authController.js";
import User from "../server/models/User.js";

test("buildResetPasswordUrl points to the frontend forgot page", () => {
  assert.equal(
    buildResetPasswordUrl("abc123", "https://example.com"),
    "https://example.com/forgot?token=abc123",
  );
});

test("resolveResetPasswordInput accepts both password field names", () => {
  assert.deepEqual(
    resolveResetPasswordInput({ token: "abc123", newPassword: "newpass123" }),
    { token: "abc123", newPassword: "newpass123" },
  );

  assert.deepEqual(
    resolveResetPasswordInput({ token: "abc123", password: "newpass123" }),
    { token: "abc123", newPassword: "newpass123" },
  );
});

test("createPasswordResetToken saves the reset token and expiry", async () => {
  const user = {
    resetPasswordToken: undefined,
    resetPasswordExpires: undefined,
    save: async function () {
      this.saved = true;
      return this;
    },
  };

  const token = await User.prototype.createPasswordResetToken.call(user);

  assert.equal(typeof token, "string");
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(user.resetPasswordToken.length, 64);
  assert.ok(user.resetPasswordExpires);
  assert.equal(user.saved, true);
});

test("validatePasswordStrength enforces the expected rules", () => {
  assert.equal(
    validatePasswordStrength("short"),
    "Password must be at least 8 characters long.",
  );
  assert.equal(
    validatePasswordStrength("abcdefgh"),
    "Password must include at least one number.",
  );
  assert.equal(
    validatePasswordStrength("abcdefgh1"),
    "Password must include at least one special character.",
  );
  assert.equal(validatePasswordStrength("abc123!@#"), "");
});
