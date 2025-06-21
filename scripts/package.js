// scripts/package.js

const fs = require('fs');
const path = require('path');

// Get the root directory of the project
const projectRoot = path.join(__dirname, '..');

// Define paths to the directories and files we'll be working with
const directoriesToClean = [
    path.join(projectRoot, 'node_modules'),
    path.join(projectRoot, 'frontend', 'node_modules'),
    path.join(projectRoot, 'frontend', '.next'),
    path.join(projectRoot, 'dist'),
    path.join(projectRoot, 'app'),
    path.join(projectRoot, 'service', 'dist'),
    path.join(projectRoot, 'service', 'build'),
];

const filesToClean = [
    path.join(projectRoot, 'package-lock.json'),
    path.join(projectRoot, 'frontend', 'package-lock.json'),
];

const appDir = path.join(projectRoot, 'app');
const sourcePackageJson = path.join(projectRoot, 'package.json');
const destPackageJson = path.join(appDir, 'package.json');
const sourceMain = path.join(projectRoot, 'frontend', 'main.js');
const destMain = path.join(appDir, 'main.js');
const sourcePreload = path.join(projectRoot, 'frontend', 'preload.js');
const destPreload = path.join(appDir, 'preload.js');
const sourceOut = path.join(projectRoot, 'frontend', 'out');
const destOut = path.join(appDir, 'out');

/**
 * A robust, cross-platform function to delete a directory recursively.
 * @param {string} dirPath The path to the directory to delete.
 */
function deleteDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
        console.log(`Cleaning directory: ${dirPath}`);
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

/**
 * A robust, cross-platform function to delete a file.
 * @param {string} filePath The path to the file to delete.
 */
function deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
        console.log(`Cleaning file: ${filePath}`);
        fs.unlinkSync(filePath);
    }
}

/**
 * Main function to run the packaging preparation steps.
 */
function packageApp() {
    try {
        console.log('--- Starting build preparation ---');

        // 1. Clean all specified directories and files
        console.log('\n--- Cleaning old build artifacts ---');
        directoriesToClean.forEach(deleteDirectory);
        filesToClean.forEach(deleteFile);

        // 2. Create the new 'app' directory for packaging
        console.log(`\n--- Creating fresh 'app' directory ---`);
        fs.mkdirSync(appDir, { recursive: true });

        // 3. Create a clean package.json for the final app
        console.log('\n--- Creating production package.json ---');
        const rootPackageJson = JSON.parse(fs.readFileSync(sourcePackageJson, 'utf-8'));
        
        // Create a new object for the production package.json
        const productionPackageJson = {
            name: rootPackageJson.name,
            version: rootPackageJson.version,
            description: rootPackageJson.description,
            main: rootPackageJson.main,
            author: rootPackageJson.author,
            license: rootPackageJson.license,
            dependencies: rootPackageJson.dependencies
        };

        // Write the clean package.json to the app directory
        fs.writeFileSync(destPackageJson, JSON.stringify(productionPackageJson, null, 2));
        console.log(`Created clean package.json at ${destPackageJson}`);

        // 4. Copy other essential files into the 'app' directory
        console.log('\n--- Copying other files to "app" directory ---');
        console.log(`Copying ${sourceMain} to ${destMain}`);
        fs.copyFileSync(sourceMain, destMain);

        console.log(`Copying ${sourcePreload} to ${destPreload}`);
        fs.copyFileSync(sourcePreload, destPreload);

        console.log(`Copying directory ${sourceOut} to ${destOut}`);
        fs.cpSync(sourceOut, destOut, { recursive: true });

        console.log('\n--- Build preparation complete! ---');

    } catch (error) {
        console.error('\n--- An error occurred during build preparation ---');
        console.error(error);
        process.exit(1); // Exit with an error code
    }
}

// Run the main function
packageApp();
