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
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const exec = promisify(execCallback);

async function getYoutubeVideoInfo(url) {
  try {
    const { stdout } = await exec(`yt-dlp -j ${url}`);
    const videoInfo = JSON.parse(stdout);

    return {
      id: videoInfo.id,
      title: videoInfo.title,
      duration: videoInfo.duration,
    };
  } catch (error) {
    const errorMsg = `Error get yt video info: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
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
    const errorMsg = `Error creating signed URL: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
    throw error; // Handle error appropriately
  }
}

async function deleteFileToGCS(destination) {
  const bucket = storage.bucket(bucketName);
  const fullDestination = path.join(gcsPath, destination);
  const file = bucket.file(fullDestination);

  try {
    await file.delete();
    console.log(`File ${fullDestination} deleted.`);
  } catch (error) {
    const errorMsg = `Error deleting file: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
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
        iconUrl: params.image,
        modelName: params.modelName,
        duration: info.duration,
      };
      const record = await saveDataToDatabase(data);
      const fileName = `${record.id}.mp3`;
      const outputPath = path.join(outputDir, fileName);
      const command = `yt-dlp --extract-audio --audio-format mp3 -o '${outputPath}' '${params.url}'`;

      try {
        const { stderr } = await exec(command);

        if (stderr) {
          const errorMsg = `Error download yt video: ${stderr}`;
          handleError(errorMsg);
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
        const errorMsg = `Error process yt video: ${error.message}\nStack trace: ${error.stack}`;
        handleError(errorMsg);
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
    const errorMsg = `Error save video info: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
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
                title: `${record.modelName} Cover`,
                body: `${record.title} has been processed. Let's enjoy it!`,
              },
              data: {
                object: JSON.stringify(record),
              },
            };
            const responseFCM = await admin.messaging().send(message);
            console.log("Successfully sent message:", responseFCM);
            res.status(200).send("Webhook processed successfully.");
          })
          .on("error", (err) => {
            const errorMsg = `Error upload file: ${err}`;
            handleError(errorMsg);
            // Handle error appropriately
            res.status(500).send("Failed to upload file");
          });
        break;
      case "failed":
        let record = await prisma.videoConvert.findUnique({
          where: {
            id: parseInt(id),
          },
        });

        if (record?.status !== "error") {
          record = await prisma.videoConvert.update({
            where: {
              id: parseInt(id),
            },
            data: {
              status: "error",
            },
          });
          // Send notification to deviceToken
          const message = {
            token: record.deviceToken,
            notification: {
              title: `${record.modelName} Cover`,
              body: `${record.title} process failed`,
            },
            data: {
              error: JSON.stringify(data.error),
            },
          };
          const responseFCM = await admin.messaging().send(message);
          console.log("Successfully sent message:", responseFCM);
        }

        const errorMsg = `Error Replicate process: ${data.error}`;
        res.status(403).send(errorMsg);
        handleError(errorMsg);
        break;
      default:
        console.log("Webhook is listening...");
        break;
    }
  } catch (error) {
    const errorMsg = `Error handling Replicate webhook: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
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
    const errorMsg = `Error fetch video converts: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);

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

    if (video?.status == "successfully") {
      video["output"] = await getPresignedUrl(video.id);
    }

    res.json(video);
  } catch (error) {
    const errorMsg = `Error get video detail: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
    res.status(500).send("Internal Server Error");
  }
};

export const removeVideoConvert = async (req, res) => {
  try {
    const videoId = req.params.id;

    // Check if the video record exists before attempting to delete
    const existingVideo = await prisma.videoConvert.findUnique({
      where: {
        id: parseInt(videoId),
      },
    });

    if (!existingVideo) {
      // If the video record does not exist, return a 404 Not Found
      return res.status(404).send("Video not found");
    }

    // Proceed with deletion since the video record exists
    let video = await prisma.videoConvert.delete({
      where: {
        id: parseInt(videoId),
      },
    });

    if (video?.status == "successfully") {
      const fileName = `${video.id}.mp3`;
      video["output"] = await deleteFileToGCS(fileName);
    }

    res.json(video);
  } catch (error) {
    const errorMsg = `Error remove video: ${error.message}\nStack trace: ${error.stack}`;
    handleError(errorMsg);
    res.status(500).send("Internal Server Error");
  }
};

const handleError = (errorMsg) => {
  console.error(errorMsg);
  axios
    .post(discordWebhookUrl, {
      content: errorMsg,
    })
    .catch(console.error);
};
