import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        fs: {
            allow: ['..'] // Allow serving files from root (for manifest/photos)
        },
        proxy: {
            '/api': 'http://localhost:3002',
            '/photos': 'http://localhost:3002'
        }
    }
})
