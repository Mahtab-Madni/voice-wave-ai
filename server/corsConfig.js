export function createCorsOptions(env = process.env) {
  const allowedOrigins = [
    env.FRONTEND_URL,
    env.CORS_ALLOWED_ORIGINS,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://voice-wave-xi.vercel.app",
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(",").map((entry) => entry.trim()))
    .filter(Boolean);

  const allowAllOrigins = env.ALLOW_ALL_ORIGINS === "true";

  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowAllOrigins || allowedOrigins.includes(origin)) {
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
