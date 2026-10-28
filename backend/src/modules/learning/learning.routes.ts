import { Router } from "express";
import { z } from "zod";
import { absolutePath } from "../../storage/storage";
import { authenticate, requireRole } from "../../middleware/auth";
import { unauthorized } from "../../utils/errors";
import * as learning from "./learning.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");
const seconds = z.number().int().min(0).max(86_400);

const progressBody = z.object({ position_seconds: seconds, completed: z.boolean().optional() });
const noteBody = z.object({ timestamp_seconds: seconds, content: z.string().trim().min(1, "Write something first").max(5000) });
const bookmarkBody = z.object({ timestamp_seconds: seconds });

router.get("/courses/:id/learn", authenticate, requireRole("student", "instructor", "admin"), async (req, res) => {
  res.json(await learning.getLearnOutline(uuid.parse(req.params.id), req.user!));
});

router.get("/courses/:id/mastery", authenticate, requireRole("student"), async (req, res) => {
  res.json(await learning.getMastery(uuid.parse(req.params.id), req.user!));
});

router.post("/lectures/:id/playback", authenticate, requireRole("student", "instructor", "admin"), async (req, res) => {
  res.json(await learning.createPlayback(uuid.parse(req.params.id), req.user!));
});

// Not behind `authenticate`: the signed ?token= in the URL is the credential (see createPlayback).
// res.sendFile gives us HTTP Range support for free, which is what lets the browser seek in a video.
router.get("/media/lectures/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  let file;
  try {
    file = await learning.getVideoFileForToken(id, String(req.query.token ?? ""));
  } catch (err) {
    if (err instanceof Error && err.name.includes("Token")) throw unauthorized("Invalid or expired video link");
    if (err instanceof Error && err.message.includes("different lecture")) throw unauthorized("Invalid video link");
    throw err;
  }
  res.sendFile(absolutePath(file.relative), {
    dotfiles: "allow",
    headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600" },
  });
});

router.post("/lectures/:id/progress", authenticate, requireRole("student"), async (req, res) => {
  res.json(await learning.saveProgress(uuid.parse(req.params.id), req.user!, progressBody.parse(req.body)));
});

router.get("/lectures/:id/notes", authenticate, requireRole("student"), async (req, res) => {
  res.json(await learning.listNotes(uuid.parse(req.params.id), req.user!));
});
router.post("/lectures/:id/notes", authenticate, requireRole("student"), async (req, res) => {
  res.status(201).json(await learning.addNote(uuid.parse(req.params.id), req.user!, noteBody.parse(req.body)));
});
router.delete("/notes/:id", authenticate, requireRole("student"), async (req, res) => {
  await learning.deleteNote(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

router.get("/lectures/:id/bookmarks", authenticate, requireRole("student"), async (req, res) => {
  res.json(await learning.listBookmarks(uuid.parse(req.params.id), req.user!));
});
router.post("/lectures/:id/bookmarks", authenticate, requireRole("student"), async (req, res) => {
  res.status(201).json(await learning.addBookmark(uuid.parse(req.params.id), req.user!, bookmarkBody.parse(req.body)));
});
router.delete("/bookmarks/:id", authenticate, requireRole("student"), async (req, res) => {
  await learning.deleteBookmark(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

export default router;
