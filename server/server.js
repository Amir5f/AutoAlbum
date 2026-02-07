const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { scanDirectory } = require('./scan');
const { selectFolder } = require('./dialogs');
const figlet = require('figlet');
const chalk = require('chalk');
const open = require('open');

const os = require('os');
// --- Constants & State ---
const app = express();
const PORT = 3002;
const HOST = '127.0.0.1'; // Force localhost for security

// Default Directory Logic
const defaultDir = process.env.AUTO_ALBUM_ROOT || path.join(os.homedir(), 'Pictures', 'Auto Album');
// Ensure it exists if we are likely to use it
if (!fs.existsSync(defaultDir)) {
    try { fs.mkdirSync(defaultDir, { recursive: true }); } catch (e) { }
}

// Default to Env Var, Command Line Arg, or default location
let ROOT_DIR = process.env.AUTO_ALBUM_ROOT || (process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : defaultDir);
let g_scanProgress = { current: 0, total: 0, status: 'idle' };

// --- Security Middleware ---

// Restrict CORS to specific local origins
const allowedOrigins = [
    `http://localhost:${PORT}`,
    'http://localhost:5173', // Vite Dev
    'http://127.0.0.1:5173'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        // but for a browser-based local app, we want to be strict.
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS Policy: Access denied from this origin.'));
        }
    }
}));

app.use(express.json({ limit: '50mb' }));

// Helper for Path Jailing
const isSafePath = (targetPath) => {
    const forbidden = ['/etc', '/var', '/bin', '/sbin', '/lib', '/sys', '/proc', '/dev'];
    const resolved = path.resolve(targetPath);

    // Simple check: Don't allow system roots
    if (forbidden.some(dir => resolved.startsWith(dir))) return false;

    // Don't allow root itself
    if (resolved === '/' || (resolved.length === 3 && resolved.endsWith(':\\'))) return false;

    return true;
};

// --- Routes ---

// Dynamic Static File Serving
// We use a function wrapper to ensure we always serve from the CURRENT ROOT_DIR
app.use('/photos', (req, res, next) => {
    // Double check path traversal even if ROOT_DIR is "safe"
    const targetFile = path.join(ROOT_DIR, req.path);
    const resolvedRoot = path.resolve(ROOT_DIR);
    const resolvedFile = path.resolve(targetFile);

    if (!resolvedFile.startsWith(resolvedRoot)) {
        return res.status(403).json({ error: "Access Denied: Path Traversal Detected" });
    }

    express.static(ROOT_DIR)(req, res, next);
});

// Serve frontend in production (dist)
app.use(express.static(path.join(__dirname, '..', 'dist')));

// API: Trigger Scan
app.post('/api/scan', async (req, res) => {
    try {
        g_scanProgress = { current: 0, total: 0, status: 'scanning' };

        const manifest = await scanDirectory(ROOT_DIR, (current, total) => {
            g_scanProgress = { current, total, status: 'scanning' };
        }, true); // Fast Scan

        g_scanProgress.status = 'idle';
        const count = Array.isArray(manifest) ? manifest.length : (manifest.photos?.length || 0);
        res.json({ success: true, count, manifest });

        // Background Enrichment
        scanDirectory(ROOT_DIR, null, false).catch(console.error);
    } catch (error) {
        g_scanProgress.status = 'error';
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Save Manifest (and Config)
app.post('/api/save', async (req, res) => {
    try {
        const manifest = req.body;
        // Basic validation
        if (!manifest.photos || !Array.isArray(manifest.photos)) {
            if (!Array.isArray(manifest)) throw new Error("Invalid manifest format");
        }

        const safeSavePath = path.join(ROOT_DIR, 'AutoAlbum.json');
        if (!isSafePath(safeSavePath)) throw new Error("Insecure save location");

        await fs.promises.writeFile(safeSavePath, JSON.stringify(manifest, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error("Save failed", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Get Manifest
app.get('/api/manifest', (req, res) => {
    const manifestPath = path.join(ROOT_DIR, 'AutoAlbum.json');
    if (fs.existsSync(manifestPath)) {
        res.sendFile(manifestPath);
    } else {
        // Fallback
        res.json({ title: "New Album", config: { density: 4, rotation: 6 }, photos: [] });
    }
});

// API: Open Folder (Dialog or Path)
app.post('/api/open', async (req, res) => {
    try {
        let selectedPath = req.body.path;

        // If no path provided, trigger native dialog
        if (!selectedPath) {
            selectedPath = await selectFolder();
        }

        if (selectedPath) {
            // Path Jailing Check
            if (!isSafePath(selectedPath)) {
                return res.status(403).json({ success: false, message: "Access Denied: Sensitive directory" });
            }

            // Verify path exists
            if (!fs.existsSync(selectedPath)) {
                return res.status(400).json({ success: false, message: "Directory does not exist" });
            }

            ROOT_DIR = selectedPath;
            console.log(`Switched Active Directory: ${ROOT_DIR}`);

            // Auto-scan new directory
            g_scanProgress = { current: 0, total: 0, status: 'scanning' };
            const manifest = await scanDirectory(ROOT_DIR, (current, total) => {
                g_scanProgress = { current, total, status: 'scanning' };
            }, true); // Fast Scan
            g_scanProgress.status = 'idle';

            const count = Array.isArray(manifest) ? manifest.length : (manifest.photos?.length || 0);
            res.json({ success: true, path: ROOT_DIR, count });

            // Background Enrichment
            scanDirectory(ROOT_DIR, null, false).catch(console.error);
        } else {
            res.json({ success: false, message: "No folder selected" });
        }
    } catch (e) {
        console.error("Open failed", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Status (Current Directory)
app.get('/api/status', (req, res) => {
    res.json({ rootDir: ROOT_DIR });
});

// API: Progress
app.get('/api/progress', (req, res) => {
    res.json(g_scanProgress);
});

// API: Shutdown
app.post('/api/shutdown', (req, res) => {
    res.json({ success: true });
    // Allow response to send before killing process
    setTimeout(() => {
        console.log("Shutting down...");
        process.exit(0);
    }, 500);
});

// SPA Fallback
app.get(/(.*)/, (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/photos')) {
        res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    } else {
        res.status(404).json({ error: 'Not Found' });
    }
});

app.listen(PORT, HOST, async () => {

    console.clear();
    const title = figlet.textSync('AUTO ALBUM', { font: 'Doom' });
    console.log(chalk.hex('#FF5555')(title));
    console.log(chalk.cyan('  Your memories, beautifully organized.'));
    console.log('');
    console.log(`  > Server running at: http://localhost:${PORT}`);
    console.log(`  > Active Directory:  ${ROOT_DIR}`);
    console.log(`  > Press Ctrl+C to stop.`);
    console.log('');

    // Auto-Open Browser logic (for standalone CLI/PKG usage)
    // Only if running within a PKG binary
    if (process.pkg) {
        try {
            open(`http://localhost:${PORT}`);
        } catch (e) {
            // Ignore error
        }
    }

    // Initial Scan on Start
    console.log("Performing initial scan...");
    try {
        await scanDirectory(ROOT_DIR, null, true);
    } catch (e) { console.error("Initial scan failed", e); }
});
