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