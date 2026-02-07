const { exec } = require('child_process');
const os = require('os');
const path = require('path');

/**
 * Open a native folder selection dialog.
 * @returns {Promise<string|null>} The selected folder path or null if canceled.
 */
function selectFolder() {
    return new Promise((resolve, reject) => {
        const platform = os.platform();

        if (platform === 'darwin') {
            // macOS: AppleScript
            // macOS: AppleScript (Updated to force focus)
            const script = `osascript -e 'tell application "Finder" to activate' -e 'tell application "Finder" to return POSIX path of (choose folder with prompt "Select an Album Folder")'`;
            exec(script, (error, stdout, stderr) => {
                if (error) {
                    // User likely canceled
                    resolve(null);
                    return;
                }
                const selectedPath = stdout.trim();
                resolve(selectedPath);
            });
        } else if (platform === 'win32') {
            // Windows: PowerShell (modern approach via System.Windows.Forms)
            const script = `powershell -c "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog() | Out-Null; $f.SelectedPath"`;
            exec(script, (error, stdout, stderr) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const selectedPath = stdout.trim();
                resolve(selectedPath || null);
            });
        } else {
            // Linux/Other: Fallback or error (keep simple for now)
            console.warn("Folder selection not supported on this platform.");
            resolve(null);
        }
    });
}

module.exports = { selectFolder };
