//Backend/server.js
//Dependencies
const express = require('express'); //Web Framework to handle HTTP requests
const cors = require('cors');//Connects the frontend and backend
const { exec } = require('child_process'); //Execute system commands
const fs = require('fs');//deleting files after it is used
const path = require('path');//to let it work with all OS

const app= express(); //Creating an instance of express
const PORT = 5000; //Port number for the server