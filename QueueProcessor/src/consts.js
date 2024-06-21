const crypto = require('node:crypto')
require('dotenv').config()
const { z } = require('zod')

const envVarsSchema = z.object({
  MONGO_URL: z.string(),
  MONGO_DB: z.string(),
  QUEUE_PROCESSOR_ID: z.string().optional().default(() => crypto.randomBytes(16).toString('hex')),

  APP_NAME: z.string().default('workflow-dispatcher'),

  LOKI_HOST: z.string(),
  LOKI_USERNAME: z.string(),
  LOKI_PASSWORD: z.string(),
})

module.exports = envVarsSchema.parse(process.env)
