import express from "express";
const router = express.Router();
import * as videoConvertController from "../controllers/videoConvertController.js";

router.post("/", videoConvertController.handleVideoConvertByRVC);
router.get("/", videoConvertController.getVideoConvertList);

export default router;
