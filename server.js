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
app.use(
  cors({
    origin: "https://voice-wave-xi.vercel.app/",
  }),
);
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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
