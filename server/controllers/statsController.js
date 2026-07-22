import InteractionLog from "../models/InteractionLog.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import View from "../models/View.js";

const getDistinctSessionIds = async (query = {}) => {
  const sessions = await InteractionLog.distinct("sessionId", {
    sessionId: { $exists: true, $ne: null, $ne: "" },
    ...query,
  });

  return sessions.filter(Boolean);
};

export const getLiveUsers = async (_req, res) => {
  try {
    const recentSessions = await getDistinctSessionIds({
      createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const fallbackCount =
      (await User.countDocuments()) + (await Project.countDocuments());
    const liveUsers = Math.max(
      recentSessions.length,
      fallbackCount > 0 ? 1 : 0,
    );

    return res.json({ liveUsers });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const getTotalVisitors = async (_req, res) => {
  try {
    const allSessions = await getDistinctSessionIds();
    const fallbackCount =
      (await User.countDocuments()) + (await Project.countDocuments());
    const counterDoc = await View.findById("global_counter").lean();
    const totalVisitors =
      typeof counterDoc?.count === "number"
        ? counterDoc.count
        : allSessions.length > 0
          ? allSessions.length
          : fallbackCount;

    return res.json({ totalVisitors });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const incrementViews = async (_req, res) => {
  try {
    const updatedView = await View.findOneAndUpdate(
      { _id: "global_counter" },
      { $inc: { count: 1 } },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
    );

    return res.json({ totalViews: updatedView?.count ?? 0 });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};
