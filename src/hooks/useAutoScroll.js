import { useEffect, useRef } from 'react';

export function useAutoScroll(isPlaying, setIsPlaying, speed = 1, isPaused = false) {
    const animationFrameId = useRef(null);
    const lastTime = useRef(0);
    const accumulatedScroll = useRef(0);

    useEffect(() => {
        if (!isPlaying || isPaused) {
            cancelAnimationFrame(animationFrameId.current);
            lastTime.current = 0;
            return;
        }

        const scroll = (time) => {
            if (!lastTime.current) lastTime.current = time;
            const delta = time - lastTime.current;
            lastTime.current = time;

            // Accumulate speed (pixels per frame-ish)
            // Speed is treated as pixels per frame (assuming ~60fps)
            accumulatedScroll.current += speed;

            if (accumulatedScroll.current >= 1) {
                const pxToScroll = Math.floor(accumulatedScroll.current);
                window.scrollBy(0, pxToScroll);
                accumulatedScroll.current -= pxToScroll;
            }

            // Check if we reached the bottom (with buffer)
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 5) {
                setIsPlaying(false);
                return;
            }

            animationFrameId.current = requestAnimationFrame(scroll);
        };

        animationFrameId.current = requestAnimationFrame(scroll);

        return () => {
            cancelAnimationFrame(animationFrameId.current);
            lastTime.current = 0;
        };
    }, [isPlaying, speed, setIsPlaying, isPaused]);

    // stop on user interaction (Manual override)
    useEffect(() => {
        if (!isPlaying) return;

        const stop = () => {
            setIsPlaying(false);
        };

        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchstart', stop, { passive: true });
        window.addEventListener('keydown', stop, { passive: true });

        return () => {
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
            window.removeEventListener('keydown', stop);
        };
    }, [isPlaying, setIsPlaying]);
}
