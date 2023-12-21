import Replicate from "replicate";
import { promisify } from "util";
import { exec as execCallback } from "child_process";

import axios from "axios";
import fs from "fs";
import path from "path";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const exec = promisify(execCallback);

async function getYoutubeVideoInfo(url) {
  try {
    const { stdout } = await exec(`yt-dlp -j ${url}`);
    const videoInfo = JSON.parse(stdout);

    return {
      id: videoInfo.id,
      title: videoInfo.title,
    };
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

export const handleVideoConvertByRVC = async (req, res, next) => {
  const params = req.body;
  if (!params.url) {
    return res.status(400).send("URL is required");
  }

  getYoutubeVideoInfo(params.url).then(async (info) => {
    try {
      const outputDir = process.env.OUTPUT_DIR;
      const fileName = `${info.id}.mp3`;
      const command = `yt-dlp --extract-audio --audio-format mp3 -o '${outputDir}/${fileName}' '${params.url}'`;
      let success = false;

      try {
        const { stderr } = await exec(command);

        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }

        await replicate.predictions.create({
          version:
            "0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550",
          input: {
            song_input: `${process.env.APP_DOMAIN}/downloads/${fileName}`,
            rvc_model: 'Drake'
          },
          webhook: `${process.env.APP_DOMAIN}/webhooks/replicate`,
          webhook_events_filter: ["completed"],
        });
        success = true;
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }

      res.json({ ok: success });
    } catch (error) {
      next(error);
    }
  });
};

export const handleReplicateWebhook = async (req, res) => {
  try {
    const data = req.body; // Webhook data sent by Replicate

    switch (data.status) {
      case "succeeded":
        const outputFileUrl = data.output;

        const response = await axios({
          method: "GET",
          url: outputFileUrl,
          responseType: "stream",
        });

        const outputPath = path.join(
          `${process.env.OUTPUT_DIR}`,
          "outputFile.wav"
        );
        const writer = fs.createWriteStream(outputPath);

        response.data.pipe(writer);
        console.log(`Output successfully written to ${outputPath}`);

        return new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
      default:
        console.log("Webhook is listening...");
    }
  } catch (error) {
    console.error("Error handling Replicate webhook:", error);
    res.status(500).send("Internal Server Error");
  }
};
