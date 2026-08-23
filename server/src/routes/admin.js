import express from "express";
import { randomUUID } from "node:crypto";
import { ROUNDS, DIFFICULTY_POINTS } from "../gameContract.js";
import {
  listQuestions,
  upsertQuestion,
  deleteQuestion,
  setQuestionActive,
  reorderQuestions,
  getActiveQuestions,
  resetLeaderboard,
  setConfigValue,
  listMatchResults,
} from "../db.js";

const CONFIG_KEYS = ["COUNTDOWN_MS", "SECTION_DURATION_MS", "QUESTION_TIMEOUT_MS", "RUNNER_UP_POINTS"];

function validateQuestion(input) {
  const errors = [];
  if (!ROUNDS.includes(input.round)) errors.push(`round must be one of ${ROUNDS.join(", ")}`);
  if (!input.prompt || typeof input.prompt !== "string" || !input.prompt.trim()) errors.push("prompt is required");
  if (typeof input.optionA !== "string" || !input.optionA.trim()) errors.push("optionA is required and must be a string");
  if (typeof input.optionB !== "string" || !input.optionB.trim()) errors.push("optionB is required and must be a string");
  if (input.optionA === input.optionB) errors.push("options must be different");
  if (!["A", "B"].includes(input.correctOption)) errors.push("correctOption must be 'A' or 'B'");
  if (!Object.keys(DIFFICULTY_POINTS).includes(input.difficulty)) {
    errors.push(`difficulty must be one of ${Object.keys(DIFFICULTY_POINTS).join(", ")}`);
  }

  const points = input.points ?? DIFFICULTY_POINTS[input.difficulty];
  if (!Number.isInteger(points) || points <= 0) errors.push("points must be a positive integer");

  return { errors, points };
}

function refreshEngineQuestions(engine) {
  engine.setQuestions(getActiveQuestions());
}

export function buildAdminRouter(engine) {
  const router = express.Router();
  router.use(express.json());

  router.get("/questions", (req, res) => {
    res.json(listQuestions());
  });

  router.post("/questions", (req, res) => {
    const input = req.body || {};
    const id = input.id || `${input.round}-${randomUUID().slice(0, 8)}`;
    const { errors, points } = validateQuestion(input);
    if (errors.length > 0) return res.status(400).json({ errors });

    upsertQuestion({ ...input, id, points, active: input.active !== false });
    refreshEngineQuestions(engine);
    res.status(201).json({ id });
  });

  router.put("/questions/:id", (req, res) => {
    const input = { ...req.body, id: req.params.id };
    const { errors, points } = validateQuestion(input);
    if (errors.length > 0) return res.status(400).json({ errors });

    upsertQuestion({ ...input, points });
    refreshEngineQuestions(engine);
    res.json({ ok: true });
  });

  router.delete("/questions/:id", (req, res) => {
    deleteQuestion(req.params.id);
    refreshEngineQuestions(engine);
    res.json({ ok: true });
  });

  router.post("/questions/:id/active", (req, res) => {
    setQuestionActive(req.params.id, Boolean(req.body?.active));
    refreshEngineQuestions(engine);
    res.json({ ok: true });
  });

  router.post("/questions/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "orderedIds must be a non-empty array" });
    }
    reorderQuestions(orderedIds);
    refreshEngineQuestions(engine);
    res.json({ ok: true });
  });

  router.get("/config", (req, res) => {
    res.json(engine.config);
  });

  router.put("/config", (req, res) => {
    const updates = {};
    for (const key of CONFIG_KEYS) {
      if (req.body?.[key] === undefined) continue;
      const value = Number(req.body[key]);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: `${key} must be a positive number` });
      }
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "no valid config keys provided" });
    }

    Object.entries(updates).forEach(([key, value]) => setConfigValue(key, value));
    engine.updateConfig(updates);
    res.json({ ok: true, config: engine.config });
  });

  router.get("/match", (req, res) => {
    res.json(engine.getSnapshot());
  });

  router.post("/match/force-end", (req, res) => {
    engine.forceEnd();
    res.json({ ok: true });
  });

  router.post("/match/reset", (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: "reset requires { confirm: true }" });
    }
    engine.resetMatch();
    res.json({ ok: true });
  });

  router.post("/leaderboard/reset", (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: "reset requires { confirm: true }" });
    }
    resetLeaderboard();
    res.json({ ok: true });
  });

  router.get("/results", (req, res) => {
    res.json(listMatchResults());
  });

  router.get("/results/export", (req, res) => {
    const rows = listMatchResults();
    const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "id,matchCode,playerName,score,email,createdAt",
      ...rows.map((r) => [r.id, r.matchCode, r.playerName, r.score, r.email, r.createdAt].map(csvCell).join(",")),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=results.csv");
    res.send(lines.join("\n"));
  });

  return router;
}
