import express from "express";
const router = express.Router();
import * as videoConvertController from "../controllers/videoConvertController.js";

router.post("/replicate", videoConvertController.handleReplicateWebhook);

export default router;
