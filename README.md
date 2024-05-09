# 1. Introduction

This project is a music video conversion service that uses the Replicate API to convert videos. It features a RESTful API built with Node.js and Express, and uses Prisma for database management. The application also integrates with Google Cloud Storage for file storage and Firebase for notifications.

# 2. Prerequisites

- Node.js (v14.0.0 or later)
- npm (v6.0.0 or later)
- Prisma CLI (v2.0.0 or later)
- Docker (v20.10.0 or later, optional for Backend developers)
- A Google Cloud Storage account
- A Firebase account
- A Replicate API Token

# 3. Installation & Configuration

1. Clone the repository: `git clone <repository-url>`
2. Navigate to the project directory: `cd <project-directory>`
3. Copy the `firebase-service-account.json` file to the project directory.
4. Install dependencies: `npm install`
5. Copy the `.env.example` file to a new file named [`.env`] and fill in your environment variables.
6. Install `yt-dlp`:

```
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

# 4. Database Setup

1. Install the Prisma CLI globally: `npm install -g prisma`
2. Generate Prisma client: `npx prisma generate`
3. Run migrations to update the database schema: `npx prisma migrate dev`

# 5. Running the Application

1. Start the development server: `npm run dev`
2. Access the application in a web browser at `http://localhost:3000`

# 6. Usage

Send a POST request to `/api/videoConvert` with the video URL and other required parameters to start the video conversion process. The application will send a Firebase notification upon completion of the conversion.

# 7. Troubleshooting

- If you encounter issues with Prisma, try regenerating the Prisma client with `npx prisma generate`.
- If the application can't connect to Google Cloud Storage, ensure your GCS credentials are correctly set in the [`.env`] file.
- If Firebase notifications are not being sent, check your Firebase service account credentials and Firebase SDK configuration.
