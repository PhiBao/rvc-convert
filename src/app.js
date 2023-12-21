import express from "express";
import "dotenv/config";
import videoConvertRoutes from "./api/routes/videoConvertRoutes.js";
import webhookRoutes from "./api/routes/webhookRoutes.js";
import errorMiddleware from "./api/middlewares/errorMiddleware.js";
const app = express();

app.use(express.json());

// Device Routes
app.use("/api/video_converts", videoConvertRoutes);
app.use("/downloads", express.static(process.env.OUTPUT_DIR));
app.use("/webhooks", webhookRoutes);

// Error Handling Middleware
app.use(errorMiddleware);

export default app;
