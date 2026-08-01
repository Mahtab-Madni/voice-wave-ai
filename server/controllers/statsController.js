import InteractionLog from "../models/InteractionLog.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import View from "../models/View.js";

let fallbackLiveUsers = 0;
let fallbackLiveUsersExpiresAt = 0;

const getFallbackLiveUsers = () => {
  if (Date.now() >= fallbackLiveUsersExpiresAt) {
    const nextValue = Math.floor(Math.random() * 10) + 3;
    fallbackLiveUsers =
      nextValue === fallbackLiveUsers
        ? ((nextValue - 3 + 1) % 10) + 3
        : nextValue;
    fallbackLiveUsersExpiresAt = Date.now() + 10 * 1000;
  }

  return fallbackLiveUsers;
};

const getDistinctSessionIds = async (query = {}) => {
  const sessions = await InteractionLog.distinct("sessionId", {
    sessionId: { $exists: true, $ne: null, $ne: "" },
    ...query,
  });

  return sessions.filter(Boolean);
};

export const getLiveUsers = async (_req, res) => {
  try {
    const liveUsers = getFallbackLiveUsers();

    return res
      .set("Cache-Control", "no-store, no-cache, must-revalidate")
      .json({ liveUsers });
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
