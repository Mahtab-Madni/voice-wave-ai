import mongoose from "mongoose";
import Project from "../models/Project.js";

// GET /api/metrics/overview
// Aggregates usageMetrics across every project owned by the authenticated
// user. This powers the "Overview" cards shown when no project is selected.
export async function getOverviewMetrics(req, res) {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.user.id);

    const [result] = await Project.aggregate([
      { $match: { owner: ownerId } },
      {
        $group: {
          _id: null,
          projectCount: { $sum: 1 },
          voiceSessions: { $sum: "$usageMetrics.voiceSessions" },
          LLMCalls: { $sum: "$usageMetrics.LLMCalls" },
          avgConfidenceSum: { $sum: "$usageMetrics.avgConfidence" },
          executionSuccessSum: { $sum: "$usageMetrics.executionSuccess" },
        },
      },
    ]);

    const projectCount = result?.projectCount || 0;

    // voiceSessions / LLMCalls are raw counts, so they sum cleanly across
    // projects. avgConfidence / executionSuccess are already percentages per
    // project, so summing them would be meaningless — average them instead.
    const metrics = {
      voiceSessions: result?.voiceSessions || 0,
      LLMCalls: result?.LLMCalls || 0,
      avgConfidence: projectCount
        ? Number((result.avgConfidenceSum / projectCount).toFixed(1))
        : 0,
      executionSuccess: projectCount
        ? Number((result.executionSuccessSum / projectCount).toFixed(1))
        : 0,
    };

    return res.json({ ok: true, metrics, projectCount });
  } catch (error) {
    console.error("Error fetching overview metrics:", error);
    return res
      .status(500)
      .json({ ok: false, message: "Unable to load overview metrics." });
  }
}

// GET /api/projects/:id/metrics
// Returns usageMetrics for a single project, scoped to its owner so users
// can't read another account's numbers by guessing an id.
export async function getProjectMetrics(req, res) {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user.id,
    }).select("usageMetrics name");

    if (!project) {
      return res.status(404).json({ ok: false, message: "Project not found." });
    }

    return res.json({ ok: true, metrics: project.usageMetrics });
  } catch (error) {
    console.error("Error fetching project metrics:", error);
    return res
      .status(500)
      .json({ ok: false, message: "Unable to load project metrics." });
  }
}
