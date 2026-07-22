import mongoose from "mongoose";

const viewSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("View", viewSchema);
