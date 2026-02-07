import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FolderOpen, Linkedin } from "lucide-react";

export function WelcomeScreen({ onOpen, recentAlbums, onLoadRecent }) {
    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 relative overflow-hidden">

            {/* Background Image with Vignette */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                <img
                    src="/background.png"
                    alt="Background"
                    className="w-[150vw] max-w-[2000px] aspect-square object-cover opacity-30 animate-in fade-in zoom-in duration-1000"
                    style={{
                        maskImage: 'radial-gradient(circle, black 30%, transparent 70%)',
                        WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 70%)'
                    }}
                />
            </div>

            {/* Content */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="z-10 flex flex-col items-center gap-8 max-w-md w-full bg-black/40 backdrop-blur-sm p-8 rounded-3xl border border-white/5"
            >
                <div className="text-center space-y-2">
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50">
                        AutoAlbum
                    </h1>
                    <p className="text-white/50 text-lg font-light">
                        Turn your folders into cinematic stories.
                    </p>
                </div>

                <button
                    onClick={onOpen}
                    className="group relative px-8 py-4 bg-white text-black rounded-full font-medium hover:bg-gray-200 transition-all active:scale-95 flex items-center gap-3 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
                >
                    <FolderOpen className="w-5 h-5" />
                    <span>Open Folder</span>
                </button>

                {/* Recent Albums */}
                {recentAlbums.length > 0 && (
                    <div className="w-full pt-8 border-t border-white/10 mt-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4 text-center">
                            Recent Albums
                        </h3>
                        <div className="flex flex-col gap-2">
                            {recentAlbums.map((item, i) => {
                                const path = typeof item === 'string' ? item : item.path;
                                const title = (typeof item === 'object' && item.title) ? item.title : path.split('/').pop();

                                return (
                                    <button
                                        key={i}
                                        onClick={() => onLoadRecent(path)}
                                        title={path}
                                        className="text-left px-4 py-3 rounded-lg bg-black/40 hover:bg-black/60 transition-colors text-sm text-white/80 truncate border border-white/5 hover:border-white/20"
                                    >
                                        <span className="font-medium text-white">{title}</span>
                                        <span className="block text-[10px] text-white/30 truncate mt-0.5">{path}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </motion.div>

            {/* Credits */}
            <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-3 z-10 drop-shadow-md">
                <div className="text-xs text-white/40 font-medium tracking-widest uppercase">
                    Created by Amir Fischer
                </div>
                <div className="w-px h-3 bg-white/20"></div>
                <a
                    href="https://www.linkedin.com/in/amir-fischer/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/40 hover:text-white transition-colors"
                >
                    <Linkedin className="w-4 h-4" />
                </a>
            </div>
        </div>
    );
}
