const fs = require('fs');
const path = require('path');
const ExifReader = require('exifreader');
const glob = require('glob');
const geocoder = require('local-reverse-geocoder');
const os = require('os');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const GEO_CACHE_DIR = path.join(os.homedir(), '.auto-album', 'geo-cache');

// --- Offline Geocoder Singleton ---
let g_geocoderInitialized = false;
const initGeocoder = () => new Promise((resolve) => {
  if (g_geocoderInitialized) return resolve();

  // Ensure cache dir exists
  if (!fs.existsSync(GEO_CACHE_DIR)) {
    fs.mkdirSync(GEO_CACHE_DIR, { recursive: true });
  }

  console.log('Initializing Offline Geocoder (this may take a moment on first run)...');
  geocoder.init({
    dumpDirectory: GEO_CACHE_DIR,
    load: {
      admin1: false,
      admin2: false,
      admin3And4: false,
      alternateNames: false,
      cities: 'cities1000' // Best balance of size vs detail (~12MB)
    }
  }, () => {
    g_geocoderInitialized = true;
    console.log('Offline Geocoder Ready.');
    resolve();
  });
});

async function fetchLocationName(lat, lng) {
  try {
    await initGeocoder();

    return new Promise((resolve) => {
      geocoder.lookUp({ latitude: lat, longitude: lng }, 1, (err, res) => {
        if (err || !res || !res[0] || !res[0][0]) {
          return resolve(null);
        }
        // Result is an array of [match, distance]
        const cityItem = res[0][0];
        // Result provides: name, admin1Code, countryCode, etc.
        resolve(cityItem.name);
      });
    });
  } catch (error) {
    console.warn(`Offline geo-lookup failed: ${error.message}`);
    return null;
  }
}

async function scanDirectory(targetDir, onProgress, fastScan = false) {
  // Default to ./photos if not provided
  if (!targetDir) {
    targetDir = path.join(__dirname, 'photos');
  }

  const PHOTOS_DIR = targetDir;
  const OUTPUT_FILE = path.join(targetDir, 'AutoAlbum.json');
  const LEGACY_MANIFEST = path.join(targetDir, 'manifest.json');
  const LEGACY_CONFIG = path.join(targetDir, 'config.json');

  console.log(`Starting scan in ${PHOTOS_DIR}...`);
  try {
    // 1. Load Existing Manifest
    let existingManifest = {};
    let existingConfig = { density: 4, rotation: 6 }; // Defaults
    let albumTitle = "AutoAlbum";

    // MIGRATION: Check for legacy files if new one missing
    let fileToRead = OUTPUT_FILE;
    if (!fs.existsSync(OUTPUT_FILE) && fs.existsSync(LEGACY_MANIFEST)) {
      fileToRead = LEGACY_MANIFEST;
      // Also load legacy config
      if (fs.existsSync(LEGACY_CONFIG)) {
        try {
          const confRaw = await fs.promises.readFile(LEGACY_CONFIG, 'utf-8');
          existingConfig = { ...existingConfig, ...JSON.parse(confRaw) };
        } catch (e) { }
      }
    }

    if (fs.existsSync(fileToRead)) {
      try {
        const raw = await fs.promises.readFile(OUTPUT_FILE, 'utf-8');
        const json = JSON.parse(raw);

        if (Array.isArray(json)) {
          // Legacy Array format
          json.forEach(item => {
            if (item.src) existingManifest[item.src] = item;
            else if (item.type === 'text') existingManifest[`text_${item.id}`] = item; // Handle text nodes uniquely if needed, though usually they don't have src
          });
          // Re-map text items properly if they don't have source. Actually, text items are preserved separately below.
          // Better: just dump all into existingManifest by some key.
          // Actually, below we Iterate existingManifest values to preserve text.
          // So we need to store them by ID or reference.
          // Strategy: Store by src if available, otherwise push to a separate list? 
          // Simplified: Just iterate the array.
          json.forEach(item => {
            if (item.src) existingManifest[item.src] = item;
          });
        } else if (json.photos) {
          // New Object format
          albumTitle = json.title || albumTitle;
          if (Array.isArray(json.photos)) {
            json.photos.forEach(item => {
              if (item.src) existingManifest[item.src] = item;
            });
          }
          // Also preserve text items from json.photos? Yes.
        }
      } catch (e) {
        console.warn('Corrupt manifest, starting fresh.');
      }
    }

    // 2. Scan Directory
    const files = await fs.promises.readdir(PHOTOS_DIR);
    const imageFiles = files.filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));

    console.log(`Scanning ${imageFiles.length} images in ${PHOTOS_DIR}...`);

    const newManifestPhotos = [];


    // Process Images
    let processedCount = 0;
    const totalFiles = imageFiles.length;

    for (const file of imageFiles) {
      processedCount++;
      if (onProgress) onProgress(processedCount, totalFiles);

      try {
        const src = `photos/${file}`;
        const filePath = path.join(PHOTOS_DIR, file);

        // Preserve existing data (captions, hidden status, manual edits)
        const existingData = existingManifest[src] || {};

        // Skip expensive operations if we already have the data and file hasn't changed dramatically
        // (For a robust app we'd check mtime, but here we trust existing data mostly)
        let tags = {};
        let buffer = null;

        // Optimization: Only read parsing if we don't have basic dimensions/date
        if (!existingData.width || !existingData.date) {
          buffer = await fs.promises.readFile(filePath);
          tags = ExifReader.load(buffer);
        }

        // Extract Metadata (prefer existing)
        let isoDate = existingData.date;
        if (!isoDate && tags) {
          let dateStr = tags['DateTimeOriginal']?.description || tags['CreateDate']?.description;
          if (dateStr) {
            const [d, t] = dateStr.split(' ');
            isoDate = (d && t) ? d.replace(/:/g, '-') + 'T' + t : dateStr;
          } else {
            const stats = await fs.promises.stat(filePath);
            isoDate = stats.birthtime.toISOString();
          }
        }

        const width = existingData.width || tags['Image Width']?.value;
        const height = existingData.height || tags['Image Height']?.value;

        // GPS
        let gps = existingData.gps;
        if (!gps && tags && tags['GPSLatitude'] && tags['GPSLongitude']) {
          const lat = parseFloat(tags['GPSLatitude'].description);
          const lng = parseFloat(tags['GPSLongitude'].description);
          if (!isNaN(lat) && !isNaN(lng)) {
            gps = { lat, lng };
          }
        }

        // Location Name
        let locationName = existingData.locationName;
        // Fetch only if needed and NOT in fast mode
        if (!fastScan && gps && !locationName && !existingData.manualLocation) {
          console.log(`Fetching location for ${file}...`);
          locationName = await fetchLocationName(gps.lat, gps.lng);
          if (locationName) {
            console.log(`  -> ${locationName}`);
          }
        }

        newManifestPhotos.push({
          type: 'photo', // Explicit type
          ...existingData, // Preserves: id, caption, hidden, manualLocationName, etc.
          src,
          date: isoDate,
          width,
          height,
          gps,
          locationName
        });

      } catch (err) {
        console.error(`Failed to process ${file}: ${err.message}`);
      }
    }

    // Process Text/Custom Items (Preserve from existing manifest)
    // We need to re-read the json to find text items since existingManifest keys by src
    // Simpler: iterate existingManifest values, but we only populated src-based ones. 
    // Correction: We need to capture text items during the initial read.
    // Let's reload logic:
    // Actually, text items are in the manifest array.

    // Recovery of non-photo items:
    if (fs.existsSync(fileToRead)) {
      try {
        const raw = await fs.promises.readFile(fileToRead, 'utf-8');
        const json = JSON.parse(raw);
        const list = Array.isArray(json) ? json : (json.photos || []);

        list.forEach(item => {
          if (item.type !== 'photo') {
            newManifestPhotos.push(item);
          }
        });
      } catch (e) { }
    }


    // Sort by Date
    newManifestPhotos.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const finalManifest = {
      title: albumTitle,
      config: existingConfig,
      photos: newManifestPhotos
    };

    await fs.promises.writeFile(OUTPUT_FILE, JSON.stringify(finalManifest, null, 2));
    console.log(`Saved ${newManifestPhotos.length} items to manifest.`);

    return finalManifest;

  } catch (error) {
    console.error('Scan failed:', error);
    throw error;
  }
}

// Allow direct run
if (require.main === module) {
  scanDirectory(process.argv[2]);
}

module.exports = { scanDirectory };
