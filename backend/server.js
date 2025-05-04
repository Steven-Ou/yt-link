//Backend/server.js
//Dependencies
const express = require('express'); //Web Framework to handle HTTP requests
const cors = require('cors');//Connects the frontend and backend
const { exec } = require('child_process'); //Execute system commands
const fs = require('fs');//deleting files after it is used
const path = require('path');//to let it work with all OS
//Setting up Express App
const app= express(); //Creating an instance of express
const PORT = 5000; //Port number for the server
//Middleware
app.use(cors()); //Allows backend to accept requests from the frontend
app.use(express.json()); //Parse JSON data in requests
//Download Route
app.post('/download', (req, res) => {
    const {url} =req.body; //Extract URL from request body

    const folderName = `album_${Date.now()}`; //Generate a unique folder name
    fs.mkdirSync(folderName); //Create a new folder for the album
    const command = `yt-dlp -x --audio-format mp3 -o "${folderName}/%(title)s.%(ext)s" "${url}`; //Command to download audio

    exec(command,(error) => {
        if(error){
            console.error(`Error: ${error.message}`); //Log error if command fails
            return res.status(500).json({error: 'Failed to download audio'}); //Send error response
        }
        const zipFile = `${folderName}.zip`; //Name of the zip file
        const zipCommand = `zip -r ${zipFile} ${folderName}`; //Command to zip the folder
        //Sends the mp3 file to the client
        res.download(path.join(__dirname, zipFile),(err)=>{
            fs.rmSync(path.join(__dirname,folderName),{recursive:true}); //Delete the folder after sending
            fs.unlinkSync(path.join(__dirname,filename)); //cleaning up the file
        });
    });
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`); //Log server start
}
); //Start the server