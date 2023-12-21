import express from "express";
const router = express.Router();
import * as videoConvertController from "../controllers/videoConvertController.js";

router.post("/", videoConvertController.handleVideoConvertByRVC);

export default router;
