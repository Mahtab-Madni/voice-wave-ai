import mongoose from "mongoose";

const interactionLogSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    transcript: { type: String, default: "" },
    matchedSelector: { type: String, default: null },
    action: { type: String, default: "NONE" },
    success: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    sessionId: { type: String, default: null },
    conversationContext: { type: String, default: "" },
    ttsContext: { type: String, default: "" },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

export default mongoose.model("InteractionLog", interactionLogSchema);
