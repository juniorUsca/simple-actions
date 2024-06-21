require('dotenv').config()
const { z } = require('zod')

const envVarsSchema = z.object({
  MONGO_URL: z.string(),
  MONGO_DB: z.string(),
  MAIN_LOGS_FOLDER: z.string(),
  MAIN_TMP_FOLDER: z.string(),
})

envVarsSchema.parse(process.env)

module.exports = envVarsSchema
