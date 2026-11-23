import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleParseRule } from './server/parseRuleHandler.js'

// Serves POST /api/parse-rule during `npm run dev` with the same handler Vercel uses.
// The key is read from .env without a VITE_ prefix, so it is never put in browser code.
const localApi = (env) => ({
  name: 'local-api',
  configureServer(server) {
    server.middlewares.use('/api/parse-rule', (req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', async () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { /* handled as empty input */ }
        const result = await handleParseRule({ method: req.method, body, env })
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.body))
      })
    })
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), localApi({ ...process.env, ...loadEnv(mode, process.cwd(), '') })],
}))
