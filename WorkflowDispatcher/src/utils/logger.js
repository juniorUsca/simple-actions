const path = require('node:path')
const crypto = require('node:crypto')
const { pino } = require('pino')

const contextStorage = require('./asyncContext')

const {
  APP_NAME, LOKI_HOST, LOKI_USERNAME, LOKI_PASSWORD,
} = require('../consts')

const transport = pino.transport({
  targets: [
    {
      level: process.env.PINO_LOG_LEVEL ?? 'debug',
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    },
    {
      target: path.resolve('./src/utils/pino-transport-stream.js'),
      level: 'trace',
      options: {
        prettyOptions: {
          colorize: false,
          singleLine: true,
          translateTime: 'SYS:standard',
        },
        mkdir: true,
        dir: './logs',
        maxAgeDays: process.env.PINO_LOG_MAX_DAYS_TRACE ? +process.env.PINO_LOG_MAX_DAYS_TRACE : 31,
        filePrefix: 'logs-trace-',
      },
    },
    {
      target: path.resolve('./src/utils/pino-transport-stream.js'),
      level: 'info',
      options: {
        prettyOptions: {
          colorize: false,
          translateTime: 'SYS:standard',
        },
        mkdir: true,
        dir: './logs',
        maxAgeDays: process.env.PINO_LOG_MAX_DAYS ? +process.env.PINO_LOG_MAX_DAYS : 93,
        filePrefix: 'logs-info-',
      },
    },
    {
      target: path.resolve('./src/utils/pino-transport-stream.js'),
      level: 'error',
      options: {
        prettyOptions: {
          colorize: false,
          translateTime: 'SYS:standard',
        },
        mkdir: true,
        dir: './logs',
        maxAgeDays: process.env.PINO_LOG_MAX_DAYS ? +process.env.PINO_LOG_MAX_DAYS : 93,
        filePrefix: 'logs-error-',
      },
    },
    {
      target: 'pino-loki',
      level: 'trace',
      options: {
        batching: true,
        interval: 5,

        labels: {
          app: APP_NAME,
          node_env: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
        },
        host: LOKI_HOST,
        basicAuth: {
          username: LOKI_USERNAME,
          password: LOKI_PASSWORD,
        },
      },
    },
  ],
})

// Create a logging instance
const originalLogger = pino({
  level: 'trace',
  formatters: {
    // level: label => ({ level: label.toUpperCase() }),
    // bindings: () => ({}),
  },
  // timestamp: () => `,"time":"${new Date(Date.now()).toLocaleString()}"`,
  base: undefined, // remove pid and hostname
}, transport)

// Proxify logger instance to use child logger from context if it exists
const logger = new Proxy(originalLogger, {
  get (target, property, receiver) {
    const store = contextStorage?.getStore()
    const targetLogger = store?.get('logger') ?? target
    return Reflect.get(targetLogger, property, receiver)
  },
})

/**
 * @param {Function} next
 * @param {string} workflowId
 */
const loggerMiddleware = async (next, workflowId) => {
  const childLogger = originalLogger.child({
    cronJobTrackerId: crypto.randomUUID(),
    workflowId,
  })
  const contextStore = new Map()
  contextStore.set('logger', childLogger)

  // @ts-ignore
  await contextStorage.run(contextStore, next)
}

module.exports = {
  logger,
  loggerMiddleware,
}
