const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, 'AutoAlbum.json');

async function mockManifest() {
    try {
        const raw = await fs.promises.readFile(MANIFEST_PATH, 'utf-8');
        const original = JSON.parse(raw);

        if (original.length === 0) {
            console.error("No photos found to mock from.");
            return;
        }

        // Find some base images
        // IMG_20230226_222523.jpg: Landscape (4000x3000)
        // IMG_0101.jpg: Portrait (2316x3088)
        // IMG_5135.JPG: Portrait + GPS (Tel Aviv) (3771x5405)
        // IMG_5640.jpg: GPS (Miami)

        const portrait = original.find(p => p.height > p.width) || original[0];
        const landscape = original.find(p => p.width > p.height) || original[0];
        const gpsPhoto1 = original.find(p => p.gps && p.gps.lat > 30) || original[0]; // Tel Aviv approx
        const gpsPhoto2 = original.find(p => p.gps && p.gps.lat < 30) || original[0]; // Miami approx

        const mockData = [];

        // 1. CLUSTER A: Tel Aviv (Manual mock based on real photos)
        // Hero Shot
        mockData.push({
            ...gpsPhoto1,
            date: "2025-02-21T09:00:00",
            locationName: "Tel Aviv-Yafo"
        });

        // Diptych Cluster (Two portraits within 3 hours)
        mockData.push({
            ...portrait,
            src: portrait.src, // Re-use same image
            date: "2025-02-21T10:00:00", // +1 hour
            gps: gpsPhoto1.gps, // Same location
            _mockId: 1
        });
        mockData.push({
            ...portrait,
            src: portrait.src,
            date: "2025-02-21T11:30:00", // +1.5 hours
            gps: gpsPhoto1.gps,
            _mockId: 2
        });

        // 2. TRAVEL GAP -> Miami
        // This gap is huge (>5km), so map transition should trigger here.

        // 3. CLUSTER B: Miami
        // Hero
        mockData.push({
            ...gpsPhoto2,
            date: "2025-02-22T09:00:00", // Next day
            locationName: "Miami Beach"
        });

        // Triptych Cluster (3 portraits)
        // We'll reuse the portrait image but pretend it's in Miami
        mockData.push({
            ...portrait,
            src: portrait.src,
            date: "2025-02-22T10:00:00",
            gps: gpsPhoto2.gps,
            _mockId: 3
        });
        mockData.push({
            ...portrait,
            src: portrait.src,
            date: "2025-02-22T10:05:00",
            gps: gpsPhoto2.gps,
            _mockId: 4
        });
        mockData.push({
            ...portrait,
            src: portrait.src,
            date: "2025-02-22T10:10:00",
            gps: gpsPhoto2.gps,
            _mockId: 5
        });

        await fs.promises.writeFile(MANIFEST_PATH, JSON.stringify(mockData, null, 2));
        console.log("Mock data injected into manifest.json");

    } catch (error) {
        console.error(error);
    }
}

mockManifest();
