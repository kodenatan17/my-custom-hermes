import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // Allow importing ../opencode.json for the agent roster.
  server: { fs: { allow: [".."] } },
})
