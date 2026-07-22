import mongoose from "mongoose";

const connectDb = async () => {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/voice-wave";
  const dbName = process.env.MONGODB_NAME || "voice-wave";

  if (!process.env.MONGODB_URI) {
    console.warn(
      "[db] MONGODB_URI not set; falling back to local MongoDB at localhost:27017",
    );
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      dbName: dbName,
    });
    console.log("[db] connected to MongoDB");
  } catch (error) {
    console.error("[db] connection failed", error.message);
    throw error;
  }
};

export default connectDb;
