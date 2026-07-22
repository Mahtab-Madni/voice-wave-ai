import express from "express";
import {
  createInteractionLog,
  createProject,
  getProjectConfig,
  listInteractionLogs,
  listProjects,
  updateProject,
  updateProjectConfig,
} from "../controllers/projectController.js";

const router = express.Router();

router.get("/projects", listProjects);
router.post("/projects", createProject);
router.get("/projects/:projectId/config", getProjectConfig);
router.post("/projects/:projectId/config", updateProjectConfig);
router.put("/projects/:projectId", updateProject);
router.patch("/projects/:projectId", updateProject);
router.post("/interaction-logs", createInteractionLog);
router.get("/interaction-logs/:projectId", listInteractionLogs);

export default router;
