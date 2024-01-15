import Replicate from "replicate";
import { promisify } from "util";
import { exec as execCallback } from "child_process";

import axios from "axios";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import admin from "firebase-admin";
import serviceAccount from "../../../firebase-service-account.json" assert { type: "json" };
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

import { Storage } from "@google-cloud/storage";
const storage = new Storage({
  keyFilename: process.env.GCS_SERVICE_JSON_FILE_URL,
});
const bucketName = process.env.BUCKET_NAME;
const gcsPath = process.env.GCS_PATH;

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

async function uploadFileToGCS(filePath, destination) {
  const bucket = storage.bucket(bucketName);
  const fullDestination = path.join(gcsPath, destination);
  const file = bucket.file(fullDestination);

  await bucket.upload(filePath, {
    destination: file,
  });

  // Generate a signed URL for the uploaded file, valid for 2 hours
  const options = {
    version: "v4",
    action: "read",
    expires: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  };

  try {
    const [url] = await file.getSignedUrl(options);
    console.log(`The signed url for ${fullDestination} is ${url}`);
    return url; // This is the pre-signed URL
  } catch (error) {
    console.error("Error creating signed URL:", error);
    throw error; // Handle error appropriately
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
      const version = params.version || process.env.REPLICATE_VERSION;

      const data = {
        deviceId: params.deviceId,
        deviceToken: params.deviceToken,
        title: info.title,
        videoId: info.id,
        version: version,
        status: "processing",
      };
      const record = await saveDataToDatabase(data);
      const fileName = `${record.id}.mp3`;
      const outputPath = path.join(outputDir, fileName);
      const command = `yt-dlp --extract-audio --audio-format mp3 -o '${outputPath}' '${params.url}'`;

      try {
        const { stderr } = await exec(command);

        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }

        const gcsFileUrl = await uploadFileToGCS(outputPath, fileName);

        // Once the file is uploaded, delete the local file
        fs.unlinkSync(outputPath);
        console.log(`Local file ${outputPath} deleted`);
        let input = params.input;
        input["song_input"] = gcsFileUrl;

        const prediction = await replicate.predictions.create({
          version: version,
          input: input,
          webhook: `${process.env.APP_DOMAIN}/webhooks/replicate?id=${record.id}`,
          webhook_events_filter: ["completed"],
        });
        const cancelUrl = prediction.urls?.cancel;
        await prisma.videoConvert.update({
          where: {
            id: parseInt(record.id),
          },
          data: {
            cancelUrl: cancelUrl,
          },
        });
        res.json({ ok: true, cancelUrl: cancelUrl });
      } catch (error) {
        res.json({ ok: false, message: error.message });
        console.error(`Error: ${error.message}`);
      }
    } catch (error) {
      next(error);
    }
  });
};

async function saveDataToDatabase(data) {
  try {
    const videoConvert = await prisma.videoConvert.create({
      data,
    });
    console.log("Saved video info:", videoConvert);
    return videoConvert;
  } catch (error) {
    console.error("Failed to save video info:", error);
    // Handle or throw error appropriately
    throw error;
  }
}

export const handleReplicateWebhook = async (req, res) => {
  try {
    const data = req.body; // Webhook data sent by Replicate
    const { id } = req.query;

    switch (data.status) {
      case "succeeded":
        const outputFileUrl = data.output;

        const response = await axios({
          method: "GET",
          url: outputFileUrl,
          responseType: "stream",
        });

        const gcsFileName = path.join(gcsPath, `${id}.mp3`);
        const file = storage.bucket(bucketName).file(gcsFileName);

        // Pipe the axios stream to the GCS file
        response.data
          .pipe(file.createWriteStream())
          .on("finish", async () => {
            const record = await prisma.videoConvert.update({
              where: {
                id: parseInt(id),
              },
              data: {
                input: data.input,
                status: "successfully",
              },
            });
            // Send notification to deviceToken
            const message = {
              token: record.deviceToken,
              notification: {
                title: "File Ready",
                body: "Your file has been processed and is ready for download.",
              },
            };
            const responseFCM = await admin.messaging().send(message);
            console.log("Successfully sent message:", responseFCM);
            res.status(200).send("Webhook processed successfully.");
          })
          .on("error", (err) => {
            console.error("Failed to upload file:", err);
            // Handle error appropriately
            res.status(500).send("Failed to upload file");
          });
        break;
      case "failed":
        await prisma.videoConvert.update({
          where: {
            id: parseInt(id),
          },
          data: {
            status: "error",
          },
        });
      default:
        console.log("Webhook is listening...");
    }
  } catch (error) {
    console.error("Error handling Replicate webhook:", error);
    res.status(500).send("Internal Server Error");
  }
};

async function getPresignedUrl(fileName, hours = 4) {
  const bucket = storage.bucket(bucketName);
  const fullDestination = path.join(gcsPath, `${fileName}.mp3`);
  const file = bucket.file(fullDestination);
  const options = {
    version: "v4",
    action: "read",
    expires: Date.now() + hours * 60 * 60 * 1000,
  };

  const [url] = await file.getSignedUrl(options);

  return url;
}

export const getVideoConvertList = async (req, res) => {
  try {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      return res.status(400).send("deviceId is required");
    }

    const videoConverts = await prisma.videoConvert.findMany({
      where: {
        deviceId: deviceId,
      },
    });

    const videoConvertsResponse = await Promise.all(
      videoConverts.map(async (videoConvert) => {
        if (videoConvert.status === "successfully") {
          const url = await getPresignedUrl(videoConvert.id);
          return { ...videoConvert, output: url };
        } else {
          return videoConvert;
        }
      })
    );

    res.json(videoConvertsResponse);
  } catch (error) {
    console.error("Failed to fetch video converts:", error);
    res.status(500).send("Internal Server Error");
  }
};

export const getVideoConvert = async (req, res) => {
  try {
    const videoId = req.params.id;

    let video = await prisma.videoConvert.findUnique({
      where: {
        id: parseInt(videoId),
      },
    });

    if (video.status == "successfully") {
      video["output"] = await getPresignedUrl(video.id);
    }

    res.json(video);
  } catch (error) {
    console.error("Failed to fetch video converts:", error);
    res.status(500).send("Internal Server Error");
  }
};
