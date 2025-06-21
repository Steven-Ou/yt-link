// scripts/package.js

const fs = require('fs');
const path = require('path');

// Get the root directory of the project
const projectRoot = path.join(__dirname, '..');

// --- Path Definitions ---
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
 * Deletes a directory recursively.
 * @param {string} dirPath The path to the directory.
 */
function deleteDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
        console.log(`Cleaning directory: ${dirPath}`);
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

/**
 * This function cleans directories from a previous build.
 */
function clean() {
    console.log('--- Cleaning old build artifacts ---');
    // We only clean the 'app' and 'dist' directories now.
    // The main 'dist' script will handle the full sequence.
    deleteDirectory(appDir);
    deleteDirectory(path.join(projectRoot, 'dist'));
    deleteDirectory(path.join(projectRoot, 'service', 'dist'));
    deleteDirectory(path.join(projectRoot, 'service', 'build'));
    deleteDirectory(path.join(projectRoot, 'frontend', '.next'));
}

/**
 * This function prepares the 'app' directory for packaging.
 */
function packageForBuild() {
    try {
        console.log(`\n--- Creating fresh 'app' directory ---`);
        fs.mkdirSync(appDir, { recursive: true });

        console.log('\n--- Creating production package.json ---');
        const rootPackageJson = JSON.parse(fs.readFileSync(sourcePackageJson, 'utf-8'));
        
        const productionPackageJson = {
            name: rootPackageJson.name,
            version: rootPackageJson.version,
            description: rootPackageJson.description,
            main: rootPackageJson.main,
            author: rootPackageJson.author,
            license: rootPackageJson.license,
            dependencies: rootPackageJson.dependencies
        };

        fs.writeFileSync(destPackageJson, JSON.stringify(productionPackageJson, null, 2));
        console.log(`Created clean package.json at ${destPackageJson}`);

        console.log('\n--- Copying other files to "app" directory ---');
        fs.copyFileSync(sourceMain, destMain);
        fs.copyFileSync(sourcePreload, destPreload);
        fs.cpSync(sourceOut, destOut, { recursive: true });

        console.log('\n--- Build preparation complete! ---');
    } catch (error) {
        console.error('\n--- An error occurred during build preparation ---');
        console.error(error);
        process.exit(1);
    }
}

// --- Script Runner ---
const command = process.argv[2];

if (command === 'clean') {
    clean();
} else if (command === 'package') {
    packageForBuild();
} else {
    console.error('Invalid command. Please use "clean" or "package".');
    process.exit(1);
}
