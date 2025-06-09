//main.js
const { app, BrowserWindow} = require('electron'); // Importing app and BrowserWindow from electron
const path = require('path'); // Importing path module
const{spawn} = require('child_process'); // Importing spawn from child_process module
const isDev = require('electron-is-dev'); // Importing electron-is-dev module
const tcpPortUsed = require('tcp-port-used'); // Importing tcp-port-used module
const{autoUpdater} = require('electron-updater'); // Importing autoUpdater from electron-updater module
const log = require('electron-log'); // Importing electron-log module
const { start } = require('repl');
const { create } = require('domain');

const FLASK_PORT = 8080; // Port for Flask server
const FLASK_HOST = '127.0.0.1'; // Host for Flask server
const NEXTJS_DEV_URL ='http://localhost:3000'; // URL for Next.js development server
const flaskAppDirectory = path.join(__dirname, '..', 'service') // Directory for Flask app
const flaskAppScript = "app.py"; // Flask app script name

const pythonInterpreterPath = path.join(flaskAppDirectory, 'venv', 'bin', 'python'); // Path to Python interpreter in virtual environment
// Windows example (uncomment and adjust if needed):
// const pythonInterpreterPath = path.join(flaskAppDirectory, 'venv', 'Scripts', 'python.exe');
// If not bundling a venv and relying on system python (less recommended for packaged apps):
// const pythonInterpreterPath = 'python3'; // or 'python'

let mainWindow; // Variable to hold the main window instance
let flaskProcess = null; // Variable to hold the Flask process instance

// --- Auto Updater Logging  ---
autoUpdater.logger =log; // Set the logger for autoUpdater
autoUpdater.logger.transports.file.level = 'info'; // Set the log level to info
log.info('App starting...'); // Log the app starting message

// Disable auto-download: USER WILL BE THE ONE CONSENTING TO DOWNLOAD
autoUpdater.autoDownload = false; // Disable auto-download for updates

//--- Flask Server Mangement --- 
function startFlaskServer() {
    log.info('Starting Flask Server...'); // Log the message indicating Flask server is starting
    log.info(`Using Python interpreter at: ${pythonInterpreterPath}`); // Log the path to the Python interpreter
    log.info(`Flask app script: ${path.join(flaskAppDirectory,flaskAppScript)}`); // Log the path to the Flask app script
    log.info(`Flask working directory: ${flaskAppDirectory}`); // Log the working directory for Flask app

    try{
      flaskProcess = spawn(pythonInterpreterPath,[flaskAppDirectory], {
        cwd:flaskAppDirectory, // Set the current working directory to the Flask app directory
        stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, pipe stdout and stderr
        // On Windows, you might need shell: true if pythonInterpreterPath is just 'python'
            // and there are issues with PATH resolution, but direct path to venv is better.
            // shell: process.platform === 'win32'
       });
    } catch (error){
        log.error('Spawn failed to initiate Flask process.',error); // Log error if spawning Flask process fails
        dialog.showErrorBox('Critical Error', `Could not launch the local server (Flask): ${error.message}`); //Show error dialog if Flask process fails to start
        app.quit(); //Quit the application
        return; // Exit the function
    }

    flaskProcess.stdout.on('data', (data)=>{ // Listen for data from Flask process stdout
        const output = data.toString().trim();// Convert buffer data to string and trim whitespace 
        if(output) log.info(`Flask: ${output}`);// Log the output from Flask process 
    });

    flaskProcess.stderr.on('data', (data)=>{//Handle error data from Flask process
        const errorOutput = data.toString().trim();//Convert buffer data to string and trim whitespace
        if (errorOutput) log.error(`Flask STDERR: ${errorOutput}`);//Log the error output from Flask process
    });

    flaskProcess.on('close', (code,signal)=>{ // Handle the close event of Flask process
        log.info(`Flask process exited with code ${code} and signal ${signal}`); // Log the exit code and signal of Flask process
        flaskProcess =null; // Set flaskProcess to null after it exits
        if (code !== 0) { // If the exit code is not 0, it indicates an error
            log.error(`Flask process exited with error code: ${code}`); // Log the error code
            dialog.showErrorBox('Critical Error', `Flask server exited with code: ${code}`); // Show error dialog
            app.quit(); // Quit the application
        }
    });

    flaskProcess.on('error',(err)=>{//Handle error event of Flask process 
        log.error('Failed to start or run Flask process:', err); //Log error if Flask process fails to start or run
        dialog.showErrorBox('Flask Server Error', `Failed to start/run the local server: ${err.message}`); // Show error dialog if Flask process fails to start or run
        flaskProcess =null; // Set flaskProcess to null if it fails to start or run
        app.quit(); // Quit the application
    });

    log.info('Flask server process initiated.');// Log the message indicating Flask server process is initiated
}   
// Function to check if Flask server is running
function stopFlaskServer(){ // Function to stop the Flask server
    if(flaskProcess){
        log.info('Attempting to stop Flask Server...');// Log the message indicating Flask server is stopping 
        const killed = flaskProcess.kill();// Attempt to kill the Flask process 
        if(killed){
            log.info('Flask Server process kill signal sent.');// Log the message indicating Flask server process kill signal is sent
        }else{
            log.warn("Failed to send kill signal to Flask Server Process (Might've exited).");// Log warning if failed to send kill signal to Flask server process 
        }
        flaskProcess=null;// Set flaskProcess to null after stopping it
    }
}
// --- Application Lifecycle Management ---
function createWindow(){
    mainWindow = new BrowserWindow({ 
        width:1280,
        height:800,
        webPreferences:{
            nodeIntegration:false, // Disable Node.js integration for security
            contextIsolation:true, // Enable context isolation for security
            enableRemoteModule:false, // Disable remote module for security
            preload: path.join(__dirname, 'preload.js'), // Use a preload script for secure context
        },
        icon: path.join(__dirname, 'assets', 'icon.png'), // Set the application icon
    });
    if(isDev){ //If in development mode
        log.info(`Loading Next.js from dev server: ${NEXTJS_DEV_URL} `);// Log the message indicating loading Next.js from dev server 
        mainWindow.loadURL(NEXTJS_DEV_URL); // Load the Next.js development server URL
        mainWindow.webContents.openDevTools(); // Open developer tools
    }else{ //If in production mode
        const indexPath = path.join(__dirname, 'index.html'); // For `next export`
        log.info(`Loading Next.js from exported path: ${indexPath}`);// Log the message indicating loading Next.js from exported path
        mainWindow.loadFile(indexPath); // Load the exported Next.js HTML file
    }

    mainWindow.on('closed',()=>{
        log.info('Main window closed.'); // Log the message indicating main window is closed
        mainWindow = null;//Set mainWindow to null after it is closed 
        stopFlaskServer(); //Stop the Flask server when the main window is closed
    });
}
app.whenReady().then(async () => {// When the app is ready
    startFlaskServer(); 

    try{
        log.info(`Waiting for Flask server on port ${FLASK_PORT}...(Timeout: 20s)`); //Log the message indicating waiting for Flask server
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 500, 20000);//Poll every 500ms for 20s
        log.info(`Flask server detected on port ${FLASK_PORT}. Creating Window...`);//Log the message indicating Flask server is detected
        createWindow();// Create the main window

        if(!isDev){//If not in development mode
            log.info('Production mode: Checking for application updates...');//Log the message indicating checking for application updates
            //Wait a bit after window is shown before checking for updates
            setTimeout(()=>{// Wait for a bit before checking for updates
                autoUpdater.checkForUpdates()// Check for updates
                   .then(result =>{
                        if(result && result.updateInfo){// If there is an update available
                            log.info('Update check found info:', result.updateInfo);// Log the update information 
                        }else{
                            log.info('checkForUpdates returned no update info or null.');//Log if no update information is found
                        }
                   })
                   .catch(err =>{//If there is an error checking for updates
                        log.error('Error during inital checkForUpdates:', err);//Log the error during initial check for updates
                   });
            }, 5000);//Wait for 5 seconds before checking for updates
        }else{
            log.info('Development mode: Skipping update check.');//Log the message indicating skipping update check in development mode
        }
    } catch (err) {// If there is an error waiting for Flask server
        log.error(`Flask Server did not start on port ${FLASK_PORT} within timeout:`, err); // Log the error if Flask server did not start within timeout
        dialog.showErrorBox('Server Error', `The local server (Flask) did not start correctly on port ${FLASK_PORT}. The application will now close. Please check logs for details.`);
        // Show error dialog if Flask server did not start correctly
        stopFlaskServer(); // Stop the Flask server if it was started
        app.quit(); // Quit the application
    }

    app.on(()=>{
        if(BrowserWindow.getAllWindows().length ===0){ //If there are no open windows
            if(flaskProcess && !flaskProcess.killed){// If Flask process is running and not killed
                createWindow(); // Create the main window if it was closed
            }else{
                log.warn('Activate event: Flask process not running or killed, attempting to restart Flask and create window.');//Log warning if Flask process is not running or killed 
                startFlaskServer();// Start the Flask server again
                tcpPortUsed.waitUntilUsed(FLASK_PORT,500,10000)//Wait until Flask server is up and running  
                    .then(() =>createWindow())//Create the main window after Flask server is up
                    .catch(errActivate=>{//If there is an error waiting for Flask server
                        log.error('Flask did not restart on activate:', errActivate);//Log the error if Flask server did not restart
                        dialog.showErrorBox('Server Error', `The local server (Flask) could not be restarted. The application will now close.`);//Show error dialog if Flask server could not be restarted
                        app.quit();// Quit the application 
                    });
            }
        }
    });
});

app.on('window-all-closed',()=>{//When all window are closed
    if(process.platform !== 'darwin'){
        app.quit(); //Quit the application if all windows are closed and not on macOS
    }
});

app.on('will-quit',()=>{//When the application is about to quit
    log.info('Electron app will quit.');
    stopFlaskServer(); // Stop the Flask server when the application is about to quit
});

autoUpdater.on('Checking-for-update',()=>{//Event listener for autoUpdater events
    log.info('Updater: Checking for update...');//Log the message indicating checking for update
    if(mainWindow){//If main window exists
        mainWindow.webContents.send(
            'Update-status',
            'Checking for updates...'
        );//Send message to renderer process about checking for updates
    }
});

autoUpdater.on('Update-available',(info)=>{//Event listener for update available
    log.info('Updater: Update available.', info);//Log the message indicating update is available
    if(mainWindow){//If main window exists
        mainWindow.webContents.send(//Send message to renderer process about update available
            'Update-status',
            `Update available: v${info.version}. Release notes: ${info.releaseNotes || 'N/A'}`
        );
    }
});
 /* console.log(`Waiting for Flask server on port ${FLASK_PORT}...`); // Log the message indicating waiting for Flask server
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 5000, 1000); // Wait until the Flask server is up and running
        console.log(`Flask server detected on port ${FLASK_PORT}. Creating Window...`); // Log the message indicating Flask server is detected.
        createWindow(); // Create the main window
        //Calling the update function
        checkUpdates();// Check for updates after the window is created

if(manualCheck){//If manual check is true
        dialog.ShowMessageBox({
            title:'No Updates',
            message:'You are currently running the latest version.'
        });
    }
        */