import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { MapPin, Calendar, Camera, ChevronRight, Navigation, RefreshCw, Edit2, Save, X, EyeOff, Type, FileText, Trash2, Flag, FolderOpen, LogOut, History, Home, Play, Pause, LayoutGrid, Star, Maximize2, Plane } from "lucide-react";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { cn } from "@/lib/utils";

import { getDistance } from "geolib";
import ReactMarkdown from 'react-markdown';
import Lenis from 'lenis';

const CLUSTER_TIME_THRESHOLD = 3 * 60 * 60 * 1000;
const TRAVEL_DIST_THRESHOLD = 5000;

function App() {
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [isEditor, setIsEditor] = useState(false);


    const [config, setConfig] = useState({ density: 4, rotation: 6, imageSize: 1 });
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [recentAlbums, setRecentAlbums] = useState([]);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 100 });
    const [playMode, setPlayMode] = useState('off'); // 'off', 'slow', 'normal', 'fast'
    const [albumTitle, setAlbumTitle] = useState("AutoAlbum");
    const [currentPath, setCurrentPath] = useState(null);

    const speeds = { off: 0, slow: 0.6, normal: 1.5, fast: 4 };
    useAutoScroll(playMode !== 'off', () => setPlayMode('off'), speeds[playMode], !!selectedPhoto);

    // Load recent albums
    useEffect(() => {
        const stored = localStorage.getItem("recent_albums");
        if (stored) setRecentAlbums(JSON.parse(stored));
    }, []);

    // Initialize Lenis Smooth Scroll
    useEffect(() => {
        const lenis = new Lenis({
            duration: 2.5, // Much longer momentum
            easing: (t) => 1 - Math.pow(1 - t, 4), // Quartic ease-out for a very smooth glide
            direction: 'vertical',
            gestureDirection: 'vertical',
            smooth: true,
            mouseMultiplier: 1.5, // Responsive mouse
            smoothTouch: true, // Apply momentum on touch as well
            touchMultiplier: 2,
        });

        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }

        requestAnimationFrame(raf);

        return () => {
            lenis.destroy();
        };
    }, []);

    const fetchManifest = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/manifest');
            const manifestData = await res.json();

            // Handle Manifest Format (Array vs Object)
            let loadedPhotos = [];
            let loadedTitle = "Travel Journal";
            let loadedConfig = { density: 4, rotation: 6, imageSize: 1 };

            if (Array.isArray(manifestData)) {
                loadedPhotos = manifestData;
            } else {
                loadedPhotos = manifestData.photos || [];
                loadedTitle = manifestData.title || "AutoAlbum";
                if (manifestData.config) loadedConfig = { ...loadedConfig, ...manifestData.config };
            }

            setPhotos(loadedPhotos);
            setAlbumTitle(loadedTitle);
            setConfig(loadedConfig);

            // Sync Title to Recents if we have a path
            if (currentPath) {
                setRecentAlbums(prev => {
                    const updated = prev.map(item => {
                        const p = typeof item === 'string' ? item : item.path;
                        if (p === currentPath) return { path: p, title: loadedTitle };
                        return item;
                    });
                    localStorage.setItem("recent_albums", JSON.stringify(updated));
                    return updated;
                });
            }
        } catch (err) {
            console.error("Failed to load data", err);
        } finally {
            setLoading(false);
        }
    };

    // Poll Progress
    useEffect(() => {
        let interval;
        if (loading || syncing) { // Also show for syncing/rescan
            interval = setInterval(async () => {
                try {
                    const res = await fetch('/api/progress');
                    const data = await res.json();
                    if (data.total > 0) setScanProgress(data);
                } catch (e) {
                    console.error("Poll failed", e);
                }
            }, 300);
        }
        return () => clearInterval(interval);
    }, [loading, syncing]);

    useEffect(() => {
        fetchManifest();
    }, []);

    // Debounced config save
    const saveConfigTimer = useRef(null);
    // Config Update (Updates state, triggers auto-save via useEffect)
    const updateConfig = (newSettings) => {
        setConfig(prev => ({ ...prev, ...newSettings }));
    };

    const handleRefresh = async () => {
        setSyncing(true);
        try {
            await fetch('/api/scan', { method: 'POST' });
            // Reload manifest after slight delay to ensure write
            setTimeout(fetchManifest, 1000);
        } catch (e) {
            console.error("Scan failed", e);
        } finally {
            setTimeout(() => setSyncing(false), 1000);
        }
    };

    useEffect(() => {
        if (!currentPath || !albumTitle) return;

        setRecentAlbums(prev => {
            const updated = prev.map(item => {
                const p = typeof item === 'string' ? item : item.path;
                if (p === currentPath) return { path: p, title: albumTitle };
                return item;
            });
            localStorage.setItem("recent_albums", JSON.stringify(updated));
            return updated;
        });
    }, [albumTitle, currentPath]);

    // Auto-save Photos/Manifest
    const savePhotosTimer = useRef(null);
    // Auto-save Photos/Manifest/Config
    const saveTimer = useRef(null);
    useEffect(() => {
        if (loading || photos.length === 0) return;

        if (saveTimer.current) clearTimeout(saveTimer.current);

        saveTimer.current = setTimeout(() => {
            fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: albumTitle, config, photos })
            }).catch(e => console.error("Auto-save failed", e));
        }, 2000); // 2 second debounce

        return () => clearTimeout(saveTimer.current);
    }, [photos, config, loading, albumTitle]);

    const handleSave = async () => {
        setSyncing(true);
        try {
            await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: albumTitle, config, photos })
            });
            // Manual save confirmation
        } catch (e) {
            console.error("Save failed", e);
        } finally {
            setSyncing(false);
        }
    };

    const updatePhoto = (src, updates) => {
        setPhotos(prev => prev.map(p => p.src === src ? { ...p, ...updates } : p));
    };

    const deleteItem = (src) => {
        if (confirm("Are you sure you want to delete this item?")) {
            setPhotos(prev => prev.filter(p => p.src !== src));
        }
    };

    const handleOpenFolder = async (path = null) => {
        setLoading(true);
        try {
            const res = await fetch('/api/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await res.json();

            if (data.success) {
                const path = data.path;
                setCurrentPath(path);

                // Update Recents immediately (with placeholder title)
                const filtered = recentAlbums.filter(item => {
                    const p = typeof item === 'string' ? item : item.path;
                    return p !== path;
                });

                const newRecents = [{ path, title: "Loading..." }, ...filtered].slice(0, 5);
                setRecentAlbums(newRecents);
                localStorage.setItem("recent_albums", JSON.stringify(newRecents));

                // Reload
                setPhotos([]);
                setAlbumTitle("Travel Journal");
                fetchManifest();
            } else {
                setLoading(false);
            }
        } catch (e) {
            console.error("Open failed", e);
            setLoading(false);
        }
    };

    const handleCloseAlbum = () => {
        setPhotos([]);
    };

    const handleQuit = async () => {
        if (confirm("Quit AutoAlbum?")) {
            await fetch('/api/shutdown', { method: 'POST' });
            window.close(); // Try to close tab
            document.body.innerHTML = "<div style='display:flex;height:100vh;align-items:center;justify-content:center;color:white;background:black'><h1>Safe to Close</h1></div>";
        }
    };

    const addTextBlock = (targetDate) => {
        // Subtract 1 second to place it BEFORE the target item
        const baseDate = new Date(targetDate);
        const newTime = new Date(baseDate.getTime() - 1000).toISOString();

        const newBlock = {
            type: 'text',
            src: `text-${Date.now()}`,
            date: newTime,
            content: "## New Chapter\nWrite your story here..."
        };

        // Insert and resort
        setPhotos(prev => [...prev, newBlock].sort((a, b) => new Date(a.date) - new Date(b.date)));
    };

    // Filter out hidden items unless in editor mode
    const visiblePhotos = useMemo(() => {
        return isEditor ? photos : photos.filter(p => !p.hidden);
    }, [photos, isEditor]);

    // Process contents
    const { nodes, checkpoints } = useMemo(() => processFeed(visiblePhotos), [visiblePhotos]);

    // Virtualization
    const listRef = useRef(null);
    const virtualizer = useWindowVirtualizer({
        count: nodes.length,
        estimateSize: () => 600,
        overscan: 5,
        scrollMargin: listRef.current ? listRef.current.offsetTop : 0,
    });

    // Active Checkpoint Calculation
    const visibleItems = virtualizer.getVirtualItems();
    const topIndex = visibleItems[0]?.index || 0;
    const activeCpIndex = useMemo(() => {
        let activeIdx = -1;
        checkpoints.forEach((cp, i) => {
            const cpNodeIndex = parseInt(cp.id.replace('section-', ''), 10);
            if (cpNodeIndex <= topIndex + 1) { // Add buffer
                activeIdx = i;
            }
        });
        return activeIdx;
    }, [checkpoints, topIndex]);

    const scrollToId = (id) => {
        // Id is section-i, extract index
        const index = parseInt(id.replace('section-', ''), 10);
        if (!isNaN(index)) {
            virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
        }
    };

    if (loading) {
        const percent = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0;
        return (
            <div className="flex h-screen flex-col items-center justify-center bg-black text-white gap-6">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1 }}
                >
                    <RefreshCw className="h-12 w-12 text-white/50" />
                </motion.div>

                <div className="w-64">
                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-white/80"
                            initial={{ width: 0 }}
                            animate={{ width: `${percent}%` }}
                            transition={{ duration: 0.2 }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-white/40 mt-2 font-mono uppercase">
                        <span>Scanning Library...</span>
                        <span>{scanProgress.current} / {scanProgress.total}</span>
                    </div>
                </div>
            </div>
        );
    }

    // Zero State -> Welcome Screen
    if (photos.length === 0) {
        return (
            <WelcomeScreen
                onOpen={() => handleOpenFolder(null)}
                recentAlbums={recentAlbums}
                onLoadRecent={(path) => handleOpenFolder(path)}
            />
        );
    }

    return (
        <div className="min-h-screen relative transition-colors duration-1000 bg-black overflow-x-hidden font-sans">

            {/* Background Grain */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 mix-blend-overlay"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />



            {/* Side Navigation */}
            <nav className="fixed right-8 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col gap-4">
                <div data-lenis-prevent className="backdrop-blur-md bg-black/20 border border-white/10 rounded-2xl p-4 shadow-xl flex flex-col gap-4 max-h-[80vh] overflow-y-auto w-64 overscroll-contain hover-scrollbar transition-all">
                    <div className="text-xs font-bold text-white/40 uppercase tracking-widest sticky top-0 -mt-4 pt-4 pb-2 bg-black/60 backdrop-blur-md z-10 -mx-4 px-6 border-b border-white/5 mb-2">Journey</div>
                    {checkpoints.map((point, i) => {
                        const isActive = i === activeCpIndex;
                        return (
                            <div key={i} className="group flex items-start gap-3 relative pl-2">
                                {/* Dot / Edit Controls */}
                                <div className="mt-1.5 flex-shrink-0">
                                    {isEditor ? (
                                        <button
                                            onClick={() => updatePhoto(point.triggerSrc, { hideCheckpoint: true })}
                                            className="text-white/20 hover:text-red-400 transition-colors"
                                            title="Remove from Journey"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    ) : (
                                        <div className={cn(
                                            "w-1.5 h-1.5 rounded-full transition-all duration-500",
                                            isActive ? "bg-white scale-150 shadow-[0_0_10px_rgba(255,255,255,0.8)]" : "bg-white/20 group-hover:bg-white/80"
                                        )} />
                                    )}
                                </div>

                                <div className="flex flex-col w-full overflow-hidden">
                                    {isEditor ? (
                                        <input
                                            className="bg-transparent border-b border-white/10 text-sm font-medium text-white focus:outline-none focus:border-white/50 w-full"
                                            value={point._rawLoc || ""} // Use _rawLoc which maps to manualLocation if set
                                            placeholder={point.label}
                                            onChange={(e) => updatePhoto(point.triggerSrc, { manualLocation: e.target.value })}
                                        />
                                    ) : (
                                        <button
                                            onClick={() => scrollToId(point.id)}
                                            className={cn(
                                                "text-left w-full text-sm font-medium transition-colors truncate duration-300",
                                                isActive ? "text-white scale-105 origin-left" : "text-white/70 group-hover:text-white"
                                            )}
                                        >
                                            {point.label}
                                        </button>
                                    )}
                                    <span className="text-[10px] text-white/30 uppercase tracking-wide">
                                        {point.subLabel}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </nav>

            {/* Header / Editor Toolbar */}
            <header className="fixed top-0 left-0 right-0 p-6 z-50 flex justify-between items-start pointer-events-none">
                <div className="mix-blend-difference text-white pointer-events-auto flex flex-col gap-1">
                    {isEditor ? (
                        <input
                            value={albumTitle}
                            onChange={(e) => setAlbumTitle(e.target.value)}
                            className="bg-transparent border-b border-white/20 text-2xl font-bold tracking-tighter w-full focus:outline-none focus:border-white"
                            placeholder="Album Title"
                        />
                    ) : (
                        <h1 className="text-2xl font-bold tracking-tighter">{albumTitle}</h1>
                    )}
                    <div className="text-xs opacity-60 uppercase tracking-widest">{visiblePhotos.length} Memories</div>
                </div>

                <div className="flex flex-col items-end gap-4 pointer-events-auto">
                    {/* Editor Controls */}


                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCloseAlbum}
                            className="p-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 transition-colors"
                            title="Close Album (Home)"
                        >
                            <Home className="h-5 w-5" />
                        </button>

                        <button
                            onClick={() => handleOpenFolder(null)}
                            className="p-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 transition-colors"
                            title="Open Album"
                        >
                            <FolderOpen className="h-5 w-5" />
                        </button>

                        <button
                            onClick={() => {
                                const modes = ['off', 'slow', 'normal', 'fast'];
                                const nextIndex = (modes.indexOf(playMode) + 1) % modes.length;
                                setPlayMode(modes[nextIndex]);
                            }}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-md border transition-all duration-300",
                                playMode !== 'off' ? "bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.5)]" : "bg-black/20 text-white border-white/10 hover:bg-white/10"
                            )}
                            title={`Autoplay: ${playMode.toUpperCase()}`}
                        >
                            {playMode === 'off' ? <Play className="h-5 w-5" /> : (
                                <>
                                    {playMode === 'slow' && <span className="text-[10px] font-bold uppercase">Slow</span>}
                                    {playMode === 'normal' && <span className="text-[10px] font-bold uppercase">Normal</span>}
                                    {playMode === 'fast' && <span className="text-[10px] font-bold uppercase">Fast</span>}
                                    <Pause className="h-5 w-5" />
                                </>
                            )}
                        </button>

                        <button
                            onClick={handleQuit}
                            className="p-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            title="Quit App"
                        >
                            <LogOut className="h-5 w-5" />
                        </button>
                        {isEditor && (
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 rounded-full bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 transition-colors flex items-center gap-2"
                            >
                                <Save className="h-4 w-4" /> Save Feed
                            </button>
                        )}

                        <button
                            onClick={() => setIsEditor(!isEditor)}
                            className={cn(
                                "p-2 rounded-full backdrop-blur-md border transition-colors",
                                isEditor ? "bg-white text-black border-white" : "bg-black/20 text-white border-white/10 hover:bg-white/10"
                            )}
                            title={isEditor ? "Exit Editor" : "Edit Mode"}
                        >
                            {isEditor ? <X className="h-5 w-5" /> : <Edit2 className="h-5 w-5" />}
                        </button>

                        <button
                            onClick={handleRefresh}
                            disabled={syncing}
                            className="p-2 rounded-full bg-black/20 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                            title="Rescan Photos"
                        >
                            <RefreshCw className={cn("h-5 w-5", syncing && "animate-spin")} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Editor Controls - Fixed Bottom Left */}
            {isEditor && (
                <div className="fixed bottom-8 left-8 z-50 flex flex-col gap-2 bg-black/80 backdrop-blur-xl p-4 rounded-xl border border-white/10 w-64 shadow-2xl">
                    <div className="flex justify-between items-center text-xs text-white/60 mb-1">
                        <span>Density</span>
                        <span>{config.density}</span>
                    </div>
                    <input
                        type="range"
                        min="0" max="12" step="1"
                        value={config.density}
                        onChange={(e) => updateConfig({ density: parseInt(e.target.value) })}
                        className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                    />

                    <div className="flex justify-between items-center text-xs text-white/60 mt-2 mb-1">
                        <span>Image Size</span>
                        <span>{Math.round(config.imageSize * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0.4" max="1.6" step="0.05"
                        value={config.imageSize}
                        onChange={(e) => updateConfig({ imageSize: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                    />

                    <div className="flex justify-between items-center text-xs text-white/60 mt-2 mb-1">
                        <span>Chaos (Rotation)</span>
                        <span>{config.rotation}°</span>
                    </div>
                    <input
                        type="range"
                        min="0" max="30" step="1"
                        value={config.rotation}
                        onChange={(e) => updateConfig({ rotation: parseInt(e.target.value) })}
                        className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                    />
                </div>
            )}

            {/* Main Feed */}
            <main
                className="container mx-auto pt-32 pb-32 px-4 md:px-12 max-w-[96vw] relative z-10"
            >
                <div
                    ref={listRef}
                    style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const node = nodes[virtualItem.index];
                        const i = virtualItem.index;
                        const sectionId = `section-${i}`;

                        return (
                            <div
                                key={virtualItem.key}
                                ref={virtualizer.measureElement}
                                data-index={virtualItem.index}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualItem.start}px)`,
                                    paddingBottom: `${config.density}rem`, // Use padding for gap
                                    willChange: 'transform'
                                }}
                            >
                                {(() => {
                                    if (node.type === 'text') {
                                        return (
                                            <div id={sectionId} className="max-w-3xl mx-auto w-full group/text relative px-4 z-20">
                                                {isEditor && (
                                                    <div className="absolute -top-3 -right-3 z-20 flex gap-2 opacity-0 group-hover/text:opacity-100 transition-opacity">
                                                        <button onClick={() => deleteItem(node.item.src)} className="bg-red-500 p-2 rounded-full text-white hover:bg-red-600 shadow-lg cursor-pointer">
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                )}
                                                {isEditor ? (
                                                    <textarea
                                                        className="w-full bg-black/40 border border-white/20 p-6 rounded-lg text-white font-serif text-xl focus:outline-none focus:border-white/50 min-h-[200px]"
                                                        value={node.item.content}
                                                        onChange={(e) => updatePhoto(node.item.src, { content: e.target.value })}
                                                    />
                                                ) : (
                                                    <div className="prose prose-invert prose-xl max-w-none text-white/90 font-serif leading-relaxed drop-shadow-md">
                                                        <ReactMarkdown
                                                            components={{
                                                                h1: ({ node, ...props }) => <h1 className="text-5xl font-bold mt-12 mb-6 text-white font-sans tracking-tight drop-shadow-lg" {...props} />,
                                                                h2: ({ node, ...props }) => <h2 className="text-4xl font-bold mt-10 mb-5 text-white font-sans tracking-tight" {...props} />,
                                                                h3: ({ node, ...props }) => <h3 className="text-3xl font-semibold mt-8 mb-4 text-white font-sans" {...props} />,
                                                                p: ({ node, ...props }) => <p className="mb-6 text-2xl leading-relaxed opacity-90" {...props} />,
                                                                strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
                                                                em: ({ node, ...props }) => <em className="italic text-white/80" {...props} />,
                                                            }}
                                                        >
                                                            {node.item.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    }

                                    // MAP
                                    if (node.type === 'map') {
                                        return (
                                            <div id={sectionId}>
                                                <MapTransition
                                                    from={node.from}
                                                    to={node.to}
                                                    isEditor={isEditor}
                                                    onUpdate={(updates) => updatePhoto(node.to.src, updates)}
                                                />
                                            </div>
                                        );
                                    }

                                    // CLUSTER
                                    if (node.type === 'cluster') {
                                        const isSingle = node.items.length === 1;

                                        return (
                                            <div id={sectionId} className="relative w-full py-8 group/cluster">

                                                {isEditor && (
                                                    <div className="absolute -top-16 left-1/2 -translate-x-1/2 opacity-0 group-hover/cluster:opacity-100 transition-opacity z-20">
                                                        <button onClick={() => addTextBlock(node.items[0].date)} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-full text-xs shadow-lg">
                                                            <Type className="h-3 w-3" /> Add Text
                                                        </button>
                                                    </div>
                                                )}

                                                <div className={cn(
                                                    "flex flex-wrap items-center justify-center w-full transition-all duration-500",
                                                    isSingle ? "" : "-space-x-16"
                                                )}>
                                                    {node.items.map((photo, j) => {
                                                        // Dynamic Rotation based on Config
                                                        const limit = config.rotation;
                                                        const randRot = limit === 0 ? 0 : ((i + j) * 13) % (limit * 2) - limit;

                                                        const randY = ((i + j) * 7) % 40 - 20;
                                                        const zIndex = j;

                                                        return (
                                                            <div
                                                                key={j}
                                                                className={cn(
                                                                    "transform transition-all duration-500 hover:z-[100] hover:scale-110 ease-out",
                                                                    isSingle ? "w-full max-w-[85vw] px-6" : "w-1/2 md:w-1/3 max-w-[800px]"
                                                                )}
                                                                style={{
                                                                    rotate: `${randRot}deg`,
                                                                    marginTop: isSingle ? 0 : `${randY}px`,
                                                                    zIndex: zIndex,
                                                                    scale: isSingle ? 1 : config.imageSize
                                                                }}
                                                            >
                                                                <PhotoCard
                                                                    photo={photo}
                                                                    index={i + j}
                                                                    aspect={isSingle ? "hero" : "portrait"}
                                                                    className={cn(
                                                                        "shadow-2xl border-[6px] border-white/5",
                                                                        isSingle ? "" : "aspect-[3/4]"
                                                                    )}
                                                                    isEditor={isEditor}
                                                                    onUpdate={(updates) => updatePhoto(photo.src, updates)}

                                                                    isCheckpointTrigger={checkpoints.some(cp => cp.triggerSrc === photo.src)}
                                                                    onClick={() => setSelectedPhoto(photo)}
                                                                />
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    }

                                    // HERO SHOT
                                    const heroLimit = Math.max(2, Math.floor(config.rotation / 2)); // Less rotation for heros
                                    const heroRot = heroLimit === 0 ? 0 : ((i * 7) % (heroLimit * 2) - heroLimit);

                                    return (
                                        <div id={sectionId} className="w-full flex justify-center py-4 group/hero relative z-10">
                                            {isEditor && (
                                                <div className="absolute -top-4 opacity-0 group-hover/hero:opacity-100 transition-opacity z-20">
                                                    <button onClick={() => addTextBlock(node.item.date)} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-full text-xs shadow-lg">
                                                        <Type className="h-3 w-3" /> Add Text
                                                    </button>
                                                </div>
                                            )}
                                            <div
                                                className="w-full max-w-[85vw] transition-transform duration-700 hover:scale-[1.02] hover:rotate-0"
                                                style={{ rotate: `${heroRot}deg`, scale: config.imageSize }}
                                            >
                                                <PhotoCard
                                                    photo={node.item}
                                                    index={i}
                                                    aspect="hero"
                                                    className="shadow-2xl border-[8px] border-white/5"
                                                    isEditor={isEditor}
                                                    onUpdate={(updates) => updatePhoto(node.item.src, updates)}

                                                    isCheckpointTrigger={checkpoints.some(cp => cp.triggerSrc === node.item.src)}
                                                    onClick={() => setSelectedPhoto(node.item)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )
                    })}
                </div>
            </main>

            <AnimatePresence>
                {selectedPhoto && (
                    <Lightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
                )}
            </AnimatePresence>
        </div >
    );
}

// --- Logic ---

function processFeed(photos) {
    if (!photos.length) return { nodes: [], checkpoints: [] };

    const rawNodes = [];
    let buffer = [];

    const flushBuffer = () => {
        if (buffer.length === 0) return;

        const heros = [];
        const cluster = [];

        buffer.forEach(photo => {
            if (photo.layoutIntent === 'hero') {
                heros.push(photo);
            } else {
                // Default: Cluster everything (Portraits & Landscapes)
                // Unless explicit hero intent is set
                cluster.push(photo);
            }
        });

        heros.forEach(h => rawNodes.push({ type: 'hero', item: h }));

        if (cluster.length > 0) {
            // New Requirement: If single item in cluster, default to Hero 
            // (UNLESS explicit cluster intent)
            if (cluster.length === 1 && cluster[0].layoutIntent !== 'cluster') {
                rawNodes.push({ type: 'hero', item: cluster[0] });
            } else {
                rawNodes.push({ type: 'cluster', items: cluster });
            }
        }

        buffer = [];
    };

    for (let i = 0; i < photos.length; i++) {
        const curr = photos[i];
        const prev = photos[i - 1];

        if (curr.type === 'text') {
            flushBuffer();
            rawNodes.push({ type: 'text', item: curr });
            continue;
        }

        if (prev && prev.gps && curr.gps) {
            const dist = getDistance(prev.gps, curr.gps);
            // Only show map if distance threshold met AND user hasn't explicitly hidden this checkpoint
            if (dist > TRAVEL_DIST_THRESHOLD && !curr.hideCheckpoint) {
                flushBuffer();
                rawNodes.push({ type: 'map', from: prev, to: curr });
            }
        }

        // Cluster Logic
        // We check if we can cluster with PREVIOUS item.
        // Ensure previous item is a valid candidate (not map, not text, not undefined)
        const lastNode = rawNodes[rawNodes.length - 1];
        const isMap = lastNode?.type === 'map';

        // LAYOUT INTENT OVERRIDES
        const intent = curr.layoutIntent;

        // 1. Forced HERO
        if (intent === 'hero') {
            buffer.push(curr);
            continue;
        }

        // 2. Forced CLUSTER
        if (intent === 'cluster') {
            buffer.push(curr);
            continue;
        }

        // 3. AUTO Logic
        if (buffer.length === 0) {
            buffer.push(curr);
            continue;
        }

        const lastInScene = buffer[buffer.length - 1];
        const timeDiff = Math.abs(new Date(curr.date) - new Date(lastInScene.date));
        const sameFolder = curr.folder && (curr.folder === lastInScene.folder);

        // Default: Cluster is the preference. 
        // We aggregate everything into the scene buffer if time aligns.
        if (timeDiff < CLUSTER_TIME_THRESHOLD || sameFolder) {
            buffer.push(curr);
        } else {
            flushBuffer();
            buffer.push(curr);
        }
    }
    flushBuffer();

    const nodes = rawNodes;

    // Checkpoints
    const checkpoints = [];

    const tryAddCheckpoint = (item, nodeId) => {
        if (item.hideCheckpoint) return;

        const lastPoint = checkpoints[checkpoints.length - 1];

        // Priority: Manual Location > Folder > Location > Month/Year
        // rawLoc tracks the system-derived location 
        const loc = item.manualLocation || item.folder || item.locationName;
        const date = new Date(item.date);

        const dateFull = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const monthYear = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

        let shouldAdd = false;

        // Logic: Add if location changed significantly
        if (!lastPoint) {
            shouldAdd = true;
        } else {
            // If user manually set this location, we treat it as distinct? 
            // Or just check value equality? 
            // Value equality is safer to avoid dupes.
            const lastVal = lastPoint._rawLoc || lastPoint._monthYear;
            const currVal = loc || monthYear;

            if (lastVal !== currVal) shouldAdd = true;
        }

        if (shouldAdd) {
            checkpoints.push({
                id: nodeId,
                label: loc || monthYear,
                subLabel: loc ? dateFull : "",
                _rawLoc: loc,
                _monthYear: monthYear,
                triggerSrc: item.src
            });
        }
    };

    nodes.forEach((node, i) => {
        const nodeId = `section-${i}`;
        let contextItem = null;
        if (node.type === 'hero') contextItem = node.item;
        if (node.type === 'cluster') contextItem = node.items[0];
        if (contextItem) {
            tryAddCheckpoint(contextItem, nodeId);
        }
    });

    return { nodes, checkpoints };
}

function MapTransition({ from, to, isEditor, onUpdate }) {
    const label = to.manualLocation || to.folder || to.locationName || "New Destination";

    return (
        <div className="h-[25vh] w-full flex flex-col items-center justify-center relative py-8">
            <motion.div
                initial={{ y: 10, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ margin: "-50px" }}
                transition={{ duration: 0.8 }}
                className="z-10 flex flex-col items-center text-center"
            >
                <div className="flex items-center gap-2 mb-2 opacity-60">
                    <MapPin className="h-3 w-3 text-white" />
                    <span className="text-xs font-sans font-medium uppercase tracking-[0.2em] text-white">Arrived At</span>
                </div>

                {isEditor ? (
                    <input
                        value={to.manualLocation || label}
                        onChange={(e) => onUpdate({ manualLocation: e.target.value })}
                        className="bg-transparent border-b border-white/20 text-xl font-serif italic text-white focus:outline-none focus:border-white/50 text-center min-w-[200px]"
                        placeholder="Location Name"
                    />
                ) : (
                    <h2 className="text-2xl md:text-3xl font-serif italic text-white">
                        {label}
                    </h2>
                )}
            </motion.div>
        </div>
    );
}

function PhotoCard({ photo, index, aspect, className, isEditor, onUpdate, isCheckpointTrigger, onClick }) {
    const imgRef = useRef(null);
    const containerRef = useRef(null);

    const ratio = photo.width && photo.height ? (photo.width / photo.height) : (16 / 9);
    const displayLabel = photo.manualLocation || photo.folder || photo.locationName;

    return (
        <motion.div
            ref={containerRef}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            viewport={{ margin: "-100px" }} // Trigger earlier
            onClick={!isEditor ? onClick : undefined}
            className={cn(
                "relative overflow-hidden bg-gray-900 shadow-2xl group",
                aspect === 'hero' ? "rounded-md" : "rounded-sm",
                !isEditor && "cursor-zoom-in",
                className
            )}
            style={{
                aspectRatio: ratio
            }}
        >
            <motion.div className="absolute inset-0">
                <img
                    ref={imgRef}
                    src={photo.src}
                    alt={photo.caption}
                    className="w-full h-full object-cover transition-transform duration-700"
                    crossOrigin="anonymous"
                    loading="lazy"
                    decoding="async"
                />
            </motion.div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

            {/* EDITOR OVERLAY */}
            {isEditor && (
                <div className="absolute top-4 left-4 z-30 flex gap-2">
                    {/* Layout Controls */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ layoutIntent: photo.layoutIntent === 'cluster' ? undefined : 'cluster' }); // Toggle Cluster/Auto
                        }}
                        className={cn(
                            "p-2 rounded-full backdrop-blur-md transition-colors",
                            photo.layoutIntent === 'cluster' ? "bg-blue-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
                        )}
                        title={photo.layoutIntent === 'cluster' ? "Reset Layout" : "Force Cluster (Grid)"}
                    >
                        <LayoutGrid className="h-4 w-4" />
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ layoutIntent: photo.layoutIntent === 'hero' ? undefined : 'hero' }); // Toggle Hero/Auto
                        }}
                        className={cn(
                            "p-2 rounded-full backdrop-blur-md transition-colors",
                            photo.layoutIntent === 'hero' ? "bg-yellow-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
                        )}
                        title={photo.layoutIntent === 'hero' ? "Reset Layout" : "Force Hero (Full Width)"}
                    >
                        <Star className="h-4 w-4" />
                    </button>

                    <div className="w-px h-6 bg-white/20 mx-1 self-center" />

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ hidden: !photo.hidden });
                        }}
                        className={cn(
                            "p-2 rounded-full backdrop-blur-md transition-colors",
                            photo.hidden ? "bg-red-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
                        )}
                        title={photo.hidden ? "Unhide" : "Hide Photo"}
                    >
                        {photo.hidden ? <EyeOff className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                </div>
            )}

            {/* METADATA Overlay (Editable) */}
            <div className="absolute bottom-0 left-0 right-0 p-6 text-white opacity-0 transform translate-y-4 transition-all duration-500 group-hover:opacity-100 group-hover:translate-y-0 z-20">
                <div className="flex flex-col gap-2">
                    <div className="text-xs font-bold uppercase tracking-widest text-white/50">{new Date(photo.date).toLocaleDateString()}</div>

                    {isEditor ? (
                        <div className="flex flex-col gap-2">
                            <input
                                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm font-serif italic text-white placeholder-white/50 w-full"
                                placeholder="Location Name..."
                                value={photo.manualLocation || displayLabel || ""}
                                onChange={(e) => onUpdate({ manualLocation: e.target.value })}
                            />
                            <input
                                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm text-white/90 placeholder-white/50 w-full"
                                placeholder="Add a caption..."
                                value={photo.caption || ""}
                                onChange={(e) => onUpdate({ caption: e.target.value })}
                            />
                        </div>
                    ) : (
                        <>
                            {displayLabel && (
                                <div className="text-lg font-serif italic">{displayLabel}</div>
                            )}
                            {photo.caption && (
                                <div className="text-sm text-white/80 font-medium leading-snug">{photo.caption}</div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

export default App;

function Lightbox({ photo, onClose }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm cursor-zoom-out"
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="relative max-w-[95vw] max-h-[95vh] rounded-lg overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={photo.src}
                    alt={photo.caption}
                    className="max-w-full max-h-[90vh] object-contain"
                />

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-white text-center">
                    <h3 className="text-xl font-serif italic mb-1">
                        {photo.manualLocation || photo.folder || photo.locationName}
                    </h3>
                    {photo.caption && <p className="text-white/80">{photo.caption}</p>}
                    <p className="text-xs text-white/40 uppercase tracking-widest mt-2">
                        {new Date(photo.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-md"
                >
                    <X className="h-6 w-6" />
                </button>
            </motion.div>
        </motion.div>
    );
}
