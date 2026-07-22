import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    websiteDescription: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },
    siteCategory: { type: String, default: "E-commerce" },
    primaryLanguage: { type: String, default: "English" },
    settings: {
      routerModel: { type: String, default: "gpt-4o-mini (default)" },
      confidenceThreshold: { type: Number, default: 95 },
      trackScrollPosition: { type: Boolean, default: true },
    },
    embedSnippet: { type: String, default: "" },
    usageMetrics: {
      voiceSessions: { type: Number, default: 0 },
      avgConfidence: { type: Number, default: 0 },
      executionSuccess: { type: Number, default: 0 },
      groqCalls: { type: Number, default: 0 },
    },
    isConnected: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model("Project", projectSchema);
