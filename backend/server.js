// Backend/server.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// CORS Middleware - allow all localhost origins

// In backend/server.js, near the top (before defining any routes):

app.use(cors({
  origin: true,// This automatically reflects the request’s origin
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));


// JSON body parser (must come after CORS configuration)
app.use(express.json());

// Download Route
app.post('/download', (req, res) => {
  const { url } = req.body; // Extract URL from request body

  const folderName = `album_${Date.now()}`; // Generate a unique folder name
  fs.mkdirSync(folderName); // Create a new folder for the album
  const command = `yt-dlp -x --audio-format mp3 -o "${folderName}/%(title)s.%(ext)s" "${url}"`; // Command to download audio

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return res.status(500).json({ error: 'Failed to download audio' });
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
    }
    console.log(`stdout: ${stdout}`);

    const zipFile = `${folderName}.zip`; // Name of the zip file
    const zipCommand = `zip -r ${zipFile} ${folderName}`; // Command to zip the folder
    exec(zipCommand, (zipError) => {
      if (zipError) {
        console.error(`Error zipping the folder: ${zipError.message}`);
        return res.status(500).json({ error: 'Failed to create ZIP' });
      }
      // Send the ZIP file to the client
      res.download(path.join(__dirname, zipFile), (err) => {
        if (err) {
          console.error(`Error sending file: ${err.message}`);
        }
        fs.rmSync(path.join(__dirname, folderName), { recursive: true, force: true });
        fs.unlinkSync(path.join(__dirname, zipFile)); // Cleanup the ZIP file
      });
    });
  });
});

// OPTIONAL: Define /download-playlist endpoint if it is required by your frontend
app.post('/download-playlist', (req, res) => {
  // Your code for processing the playlist download goes here.
  // For demonstration, we send a simple JSON response:
  res.json({ message: 'Playlist download endpoint is active' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
