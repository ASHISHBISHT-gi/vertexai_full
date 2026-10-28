import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import * as certs from "./certificates.service";

const router = Router();

router.get("/certificates/me", authenticate, async (req, res) => res.json(await certs.listMyCertificates(req.user!.id)));

router.get("/certificates/verify/:code", async (req, res) => {
  res.json(await certs.verifyCertificate(z.string().min(6).max(20).parse(req.params.code)));
});

router.get("/certificates/:id/download", authenticate, async (req, res) => {
  const file = await certs.getCertificateFile(z.string().uuid().parse(req.params.id), req.user!.id);
  res.download(file.path, file.downloadName);
});

export default router;
