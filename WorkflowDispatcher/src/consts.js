require('dotenv').config()
const { z } = require('zod')

const envVarsSchema = z.object({
  MONGO_URL: z.string(),
  MONGO_DB: z.string(),

  MAIN_LOGS_FOLDER: z.string(),
  MAIN_TMP_FOLDER: z.string(),

  APP_NAME: z.string().default('workflow-dispatcher'),

  LOKI_HOST: z.string(),
  LOKI_USERNAME: z.string(),
  LOKI_PASSWORD: z.string(),
})

module.exports = envVarsSchema.parse(process.env)
