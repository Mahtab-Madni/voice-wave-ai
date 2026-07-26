import test from "node:test";
import assert from "node:assert/strict";
import { createCorsOptions } from "../server/corsConfig.js";

test("allows arbitrary origins when allow-all is enabled", () => {
  const corsOptions = createCorsOptions({ ALLOW_ALL_ORIGINS: "true" });

  corsOptions.origin("https://example.com", (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });
});

test("blocks unknown origins when allow-all is disabled", () => {
  const corsOptions = createCorsOptions({
    ALLOW_ALL_ORIGINS: "false",
    CORS_ALLOWED_ORIGINS: "https://app.example.com",
  });

  corsOptions.origin("https://unknown.example.com", (error, allowed) => {
    assert.ok(error instanceof Error);
    assert.equal(allowed, undefined);
  });
});
