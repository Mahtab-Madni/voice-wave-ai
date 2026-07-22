import jwt from "jsonwebtoken";
import Project from "../models/Project.js";
import InteractionLog from "../models/InteractionLog.js";

const getAuthenticatedUserId = (req) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    return decoded?.id || null;
  } catch {
    return null;
  }
};

const slugify = (value) => {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const ensureUniqueSlug = async (baseSlug, currentProjectId = null) => {
  const cleaned = slugify(baseSlug) || `project-${Date.now().toString(36)}`;
  let slug = cleaned;
  let counter = 1;

  while (true) {
    const existingProject = await Project.findOne({
      slug,
      ...(currentProjectId ? { _id: { $ne: currentProjectId } } : {}),
    });

    if (!existingProject) {
      return slug;
    }

    slug = `${cleaned}-${counter++}`;
  }
};

const widgetHost =
  process.env.WIDGET_HOST || "https://voice-widget-snippet.vercel.app";

const buildEmbedSnippet = (projectIdentifier) =>
  `<script src="${widgetHost}/widget.js" data-project-id="${projectIdentifier}" async></script>`;

const formatProjectConfig = (project) => ({
  projectName: project.name || "",
  websiteDescription: project.websiteDescription || "",
  websiteUrl: project.websiteUrl || "",
  siteCategory: project.siteCategory || "E-commerce",
  primaryLanguage: project.primaryLanguage || "English",
  activeModel: project.settings?.routerModel || "gpt-4o-mini (default)",
  confidenceThreshold: project.settings?.confidenceThreshold ?? 95,
  trackScroll: project.settings?.trackScrollPosition ?? true,
});

const applyProjectUpdates = async (project, payload) => {
  const {
    name,
    projectName,
    slug,
    websiteDescription,
    websiteUrl,
    siteCategory,
    primaryLanguage,
    activeModel,
    confidenceThreshold,
    trackScroll,
    ownerId,
    owner,
    ...rest
  } = payload;

  if (name || projectName) {
    project.name = String(name || projectName).trim();
  }

  if (slug) {
    project.slug = await ensureUniqueSlug(slug, project._id);
  }

  if (websiteDescription !== undefined) {
    project.websiteDescription = websiteDescription;
  }

  if (websiteUrl !== undefined) {
    project.websiteUrl = websiteUrl;
  }

  if (siteCategory !== undefined) {
    project.siteCategory = siteCategory;
  }

  if (primaryLanguage !== undefined) {
    project.primaryLanguage = primaryLanguage;
  }

  const currentSettings = project.settings?.toObject
    ? project.settings.toObject()
    : project.settings || {};

  project.settings = {
    ...currentSettings,
    ...(activeModel !== undefined ? { routerModel: activeModel } : {}),
    ...(confidenceThreshold !== undefined
      ? { confidenceThreshold: Number(confidenceThreshold) }
      : {}),
    ...(trackScroll !== undefined
      ? { trackScrollPosition: Boolean(trackScroll) }
      : {}),
  };

  Object.assign(project, rest);
  await project.save();
  return project;
};

export const listProjects = async (req, res) => {
  try {
    const ownerId = getAuthenticatedUserId(req);
    if (!ownerId) {
      return res
        .status(401)
        .json({ ok: false, message: "Authentication required." });
    }

    const projects = await Project.find({ owner: ownerId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, projects });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const createProject = async (req, res) => {
  try {
    const ownerId =
      getAuthenticatedUserId(req) || req.body.ownerId || req.body.owner;
    if (!ownerId) {
      return res
        .status(401)
        .json({ ok: false, message: "Authentication required." });
    }

    const {
      name,
      projectName,
      slug,
      websiteDescription = "",
      websiteUrl = "",
      siteCategory = "E-commerce",
      primaryLanguage = "English",
      activeModel = "gpt-4o-mini (default)",
      confidenceThreshold = 95,
      trackScroll = true,
      ownerId: _ownerId,
      owner: _owner,
      ...rest
    } = req.body;

    const resolvedName = String(name || projectName || "New Project").trim();
    const finalSlug = await ensureUniqueSlug(slug || resolvedName);

    const project = await Project.create({
      name: resolvedName,
      slug: finalSlug,
      owner: ownerId,
      websiteDescription,
      websiteUrl,
      siteCategory,
      primaryLanguage,
      settings: {
        routerModel: activeModel,
        confidenceThreshold: Number(confidenceThreshold),
        trackScrollPosition: Boolean(trackScroll),
      },
      embedSnippet: buildEmbedSnippet(finalSlug),
      ...rest,
    });

    return res.status(201).json({ ok: true, project });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
};

export const getProjectConfig = async (req, res) => {
  try {
    const ownerId = getAuthenticatedUserId(req);
    if (!ownerId) {
      return res
        .status(401)
        .json({ ok: false, message: "Authentication required." });
    }

    const project = await Project.findOne({
      _id: req.params.projectId,
      owner: ownerId,
    });
    if (!project) {
      return res.status(404).json({ ok: false, message: "Project not found." });
    }

    return res.json({
      ok: true,
      config: formatProjectConfig(project),
      project,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};

export const updateProjectConfig = async (req, res) => {
  try {
    const ownerId = getAuthenticatedUserId(req);
    if (!ownerId) {
      return res
        .status(401)
        .json({ ok: false, message: "Authentication required." });
    }

    const project = await Project.findOne({
      _id: req.params.projectId,
      owner: ownerId,
    });
    if (!project) {
      return res.status(404).json({ ok: false, message: "Project not found." });
    }

    const updatedProject = await applyProjectUpdates(project, req.body);
    return res.json({
      ok: true,
      project: updatedProject,
      config: formatProjectConfig(updatedProject),
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
};

export const updateProject = async (req, res) => {
  try {
    const ownerId = getAuthenticatedUserId(req);
    if (!ownerId) {
      return res
        .status(401)
        .json({ ok: false, message: "Authentication required." });
    }

    const project = await Project.findOne({
      _id: req.params.projectId,
      owner: ownerId,
    });
    if (!project) {
      return res.status(404).json({ ok: false, message: "Project not found." });
    }

    const updatedProject = await applyProjectUpdates(project, req.body);
    return res.json({ ok: true, project: updatedProject });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
};

export const createInteractionLog = async (req, res) => {
  try {
    const log = await InteractionLog.create(req.body);
    return res.status(201).json({ ok: true, log });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
};

export const listInteractionLogs = async (req, res) => {
  try {
    const logs = await InteractionLog.find({ project: req.params.projectId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ ok: true, logs });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
};
