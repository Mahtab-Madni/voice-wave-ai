import express from "express";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import connectDb from "./server/config/db.js";
import authRoutes from "./server/routes/authRoutes.js";
import projectRoutes from "./server/routes/projectRoutes.js";
import voiceRoutes from "./server/voice/routes.js";
import statsRoutes from "./server/routes/statsRoutes.js";
import { setupVoiceWebSocket } from "./server/voice/websocket.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "https://voice-wave-xi.vercel.app",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.options("*", cors());

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));
app.use("/api", authRoutes);
app.use("/api", projectRoutes);
app.use("/api", statsRoutes);
app.use("/api", voiceRoutes);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "voice-accessibility-wave" });
});

const server = createServer(app);
setupVoiceWebSocket(server, {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  deepgramModel: process.env.DEEPGRAM_MODEL || "nova-2",
});

const PORT = process.env.PORT || 3000;

connectDb().catch((error) => {
  console.error("[db] startup failed", error.message);
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
