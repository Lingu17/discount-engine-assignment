// Vercel serverless function: POST /api/parse-rule  { text, brands?, platforms? }
import { handleParseRule } from '../server/parseRuleHandler.js'

export default async function handler(req, res) {
  const { status, body } = await handleParseRule({ method: req.method, body: req.body })
  res.status(status).json(body)
}
