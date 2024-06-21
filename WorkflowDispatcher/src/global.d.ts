import envVarsSchema from "./utils/loadEnvs";

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Zod.infer<typeof envVarsSchema> {}
  }
}
