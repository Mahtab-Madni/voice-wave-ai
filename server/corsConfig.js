const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createCorsOptions(env = process.env) {
  const allowedOrigins = [
    env.FRONTEND_URL,
    env.CORS_ALLOWED_ORIGINS,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://voice-wave-xi.vercel.app",
    "https://*.vercel.app",
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(",").map((entry) => entry.trim()))
    .filter(Boolean);

  const allowAllOrigins = env.ALLOW_ALL_ORIGINS === "true";

  const matchesAllowedOrigin = (origin) => {
    const normalizedOrigin = origin.toLowerCase();

    if (
      normalizedOrigin.startsWith("http://localhost") ||
      normalizedOrigin.startsWith("http://127.0.0.1") ||
      normalizedOrigin.includes(".vercel.app") ||
      normalizedOrigin.includes(".railway.app") ||
      normalizedOrigin.includes(".up.railway.app")
    ) {
      return true;
    }

    return allowedOrigins.some((entry) => {
      if (entry === origin) return true;
      if (!entry.includes("*")) return false;

      const pattern = new RegExp(
        `^${escapeRegExp(entry).replace(/\\\*/g, ".+")}$`,
      );
      return pattern.test(origin);
    });
  };

  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowAllOrigins || matchesAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  };
}
