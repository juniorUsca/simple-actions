/* eslint-disable no-await-in-loop */
const { MongoClient } = require('mongodb')
// eslint-disable-next-line no-unused-vars
const { Collection, ObjectId } = require('mongodb')
const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { QUEUE_PROCESSOR_ID, MONGO_DB, MONGO_URL } = require('./consts')
const {
  buscarProcesoYActualizarEstado, verifyAllProcessJobsIsCompleted, registerProcessStatus, getJobsWithoutStoppers,
  registerStepStatus,
  setJobStatus,
  verifyExistsProcessJobsFailed,
  getEnvironments,
  setEnvironments,
  setOutputEnvironments,
} = require('./services/process')
const { getActionInfo } = require('./services/definedActions')
const { timeout } = require('./utils/utils')

const { logger, loggerMiddleware } = require('./utils/logger')

// eslint-disable-next-line max-len
const url = MONGO_URL
const client = new MongoClient(url)

// Database Name
const dbName = MONGO_DB

/**
 * @param {{[key: string]: string}} withParams
 * @param {{jobEnvironments: {[key: string]: string}, processEnvironments: {[key: string]: string}}} envs
 */
const replaceEnvInWithParams = (withParams, envs) => {
  const newWithParams = {}
  Object.keys(withParams).forEach(key => {
    const value = withParams[key]
    if (typeof value === 'string' && value.startsWith('$_')) {
      const [envContext, envKey] = value.substring(2).split('.')

      if (envContext !== 'job' && envContext !== 'process') {
        throw new Error(`Invalid "with" param ${key}: ${value}`)
      }
      if (envContext === 'job') {
        newWithParams[key] = envs.jobEnvironments[envKey]
        return
      }
      if (envContext === 'process') {
        newWithParams[key] = envs.processEnvironments[envKey]
        return
      }
      newWithParams[key] = value
    } else {
      newWithParams[key] = value
    }
  })
  return newWithParams
}

/**
 * @param {Collection<import('./process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} jobName
 * @param {number} stepIndex
 * @param {import('./process').Step} step
 */
const processStep = async (collection, processId, jobName, stepIndex, step) => {
  const {
    name: stepName, output,
    uses, with: withParams,
    run, fork: forkCommand, env: envParams, workingDirectory,
    logPath,
  } = step

  if (!uses && !forkCommand && !run) {
    throw new Error('Step must have uses, fork or run')
  }

  const {
    procesoEnvironments,
    jobEnvironments,
  } = await getEnvironments(collection, processId, jobName)

  if (uses) {
    if (!withParams) {
      throw new Error('Step with uses must have with params')
    }
    const actionInfo = getActionInfo(uses)
    if (!actionInfo) {
      throw new Error(`Action ${uses} not found`)
    }
    // run action
    logger.info(`     - ${jobName}-${stepName} - Starting step Action "${actionInfo.name}"`)

    const childProcessPromise = new Promise((resolve, reject) => {
      const streamOut = fs.openSync(logPath, 'w')

      const envsToSet = {
        jobEnvironments: {},
        processEnvironments: {},
      }
      /** @type {Record<string, string>} */
      let outputToSet = {}

      const withParamsReplaced = replaceEnvInWithParams(withParams, {
        jobEnvironments,
        processEnvironments: procesoEnvironments,
      })

      const env = {
        _ACTION_QUEUE_PROCESSOR_ID: QUEUE_PROCESSOR_ID,
        _ACTION_PROCESS_ID: processId.toString(),
        _ACTION_JOB_NAME: jobName,
        _ACTION_STEP_INDEX: stepIndex.toString(),
        ...procesoEnvironments,
        ...jobEnvironments, // this adds _ACTION_CWD and _ACTION_TMP
        ...withParamsReplaced,
        with: JSON.stringify(withParamsReplaced),
      }
      const childProcess = fork(actionInfo.index, {
        // cwd: jobEnvironments._ACTION_CWD ? jobEnvironments._ACTION_CWD : actionInfo.route,
        cwd: actionInfo.route,
        env,
        stdio: [
          0, // Use parent's stdin for child
          streamOut, // fs.openSync('./out.log', 'w'), // Direct child's stdout to a file
          streamOut, // fs.openSync('./err.out', 'w'), // Direct child's stderr to a file
          'ipc', // Enable inter-process communication
        ],
        timeout: 1000 * 60 * 30, // timeout 30 minutes
      })

      // childProcess.send(withParams)
      childProcess.on('spawn', async () => {
        registerStepStatus(collection, processId, jobName, stepIndex, 'environment', JSON.stringify(env))
      })
      childProcess.on('error', async error => {
        logger.info(error, `     - ${jobName}-${stepName} - Child error ❌ ‼️`)

        fs.closeSync(streamOut)

        await registerStepStatus(
          collection,
          processId,
          jobName,
          stepIndex,
          'error',
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        )

        reject(error)
      })
      childProcess.on('message', message => {
        if (!message) return

        const messageString = typeof message === 'object' && !Array.isArray(message) && message !== null
          ? JSON.stringify(message)
          : message.toString()

        logger.info(`     - ${jobName}-${stepName} - Child message 💬 ${messageString}`)
        if (typeof message === 'object' && !Array.isArray(message) && message !== null) {
          // @ts-ignore
          const { jobEnvironment, processEnvironment, output: stepOutputPart } = message
          // si es un objeto con keys string y values string
          if (jobEnvironment && typeof jobEnvironment === 'object' && !Array.isArray(jobEnvironment)
            && Object.values(jobEnvironment).every(value => typeof value === 'string')) {
            envsToSet.jobEnvironments = {
              ...envsToSet.jobEnvironments,
              ...jobEnvironment,
            }
          }
          // si es un objeto con keys string y values string
          if (processEnvironment && typeof processEnvironment === 'object' && !Array.isArray(processEnvironment)
            && Object.values(processEnvironment).every(value => typeof value === 'string')) {
            envsToSet.processEnvironments = {
              ...envsToSet.processEnvironments,
              ...processEnvironment,
            }
          }
          // si es un objeto con keys string y values string
          if (stepOutputPart && typeof stepOutputPart === 'object' && !Array.isArray(stepOutputPart)
            && Object.values(stepOutputPart).every(value => typeof value === 'string')) {
            outputToSet = {
              ...outputToSet,
              ...stepOutputPart,
            }
          }
        }
        registerStepStatus(collection, processId, jobName, stepIndex, 'message', messageString)
      })
      childProcess.on('exit', async code => {
        fs.closeSync(streamOut)
        logger.info(`     - ${jobName}-${stepName} - Child exited with code ${code}`)

        await setEnvironments(collection, processId, {
          jobName,
          jobEnvironments: envsToSet.jobEnvironments,
          processEnvironments: envsToSet.processEnvironments,
        })

        await setOutputEnvironments(collection, processId, {
          jobName,
          output,
          outputToSet,
        })

        // setTimeout(async () => {
        if (code !== 0) {
          await registerStepStatus(collection, processId, jobName, stepIndex, 'error', `Child exited with code ${code}`)

          // reject(new Error(`Child exited with code ${code}`))
          resolve(false)
        } else {
          await registerStepStatus(collection, processId, jobName, stepIndex, 'completed', 'Child completed')

          resolve(true)
        }
        // }, 1500)
      })
    })

    const result = await childProcessPromise
    return result
    // this works on pipe stdout
    // childProcess.stdout.on('data', data => {
    //   console.log(`Received chunk ${data}`)
    // })
  }

  if (forkCommand) {
    if (!jobEnvironments._ACTION_CWD && !workingDirectory) {
      // eslint-disable-next-line max-len
      throw new Error('Step with fork must have working directory. Define _ACTION_CWD with actions/setCwd before fork or define workingDirectory in step')
    }
    if (!envParams) {
      throw new Error('Step with fork must have env params')
    }

    logger.info(`     - ${jobName}-${stepName} - Starting step Fork "${forkCommand}"`)
    let forkPath = forkCommand.startsWith('node ') ? forkCommand.substring(5) : forkCommand
    const currentWorkingDirectory = workingDirectory || jobEnvironments._ACTION_CWD
    forkPath = path.join(currentWorkingDirectory, forkPath)

    if (!fs.existsSync(forkPath)) {
      throw new Error(`Fork file ${forkPath} not found`)
    }

    const childProcessPromise = new Promise((resolve, reject) => {
      const streamOut = fs.openSync(logPath, 'w')

      const envsToSet = {
        jobEnvironments: {},
        processEnvironments: {},
      }
      /** @type {Record<string, string>} */
      let outputToSet = {}

      // works too to replace envs
      const envParamsReplaced = replaceEnvInWithParams(envParams, {
        jobEnvironments,
        processEnvironments: procesoEnvironments,
      })

      const env = {
        _ACTION_QUEUE_PROCESSOR_ID: QUEUE_PROCESSOR_ID,
        _ACTION_PROCESS_ID: processId.toString(),
        _ACTION_JOB_NAME: jobName,
        _ACTION_STEP_INDEX: stepIndex.toString(),
        ...procesoEnvironments,
        ...jobEnvironments, // this adds _ACTION_CWD and _ACTION_TMP
        ...envParamsReplaced,
      }
      const childProcess = fork(forkPath, {
        cwd: currentWorkingDirectory,
        env,
        stdio: [
          0, // Use parent's stdin for child
          streamOut, // fs.openSync('./out.log', 'w'), // Direct child's stdout to a file
          streamOut, // fs.openSync('./err.out', 'w'), // Direct child's stderr to a file
          'ipc', // Enable inter-process communication
        ],
        timeout: 1000 * 60 * 30, // timeout 30 minutes
      })

      childProcess.on('spawn', async () => {
        registerStepStatus(collection, processId, jobName, stepIndex, 'spawned', `Child spawned with pid ${childProcess.pid}`)
        registerStepStatus(collection, processId, jobName, stepIndex, 'environment', JSON.stringify(env))
      })
      childProcess.on('error', async error => {
        logger.info(error, `     - ${jobName}-${stepName} - Child error ❌ ‼️`)

        fs.closeSync(streamOut)

        await registerStepStatus(
          collection,
          processId,
          jobName,
          stepIndex,
          'error',
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        )

        reject(error)
      })
      childProcess.on('message', message => {
        if (!message) return

        const messageString = typeof message === 'object' && !Array.isArray(message) && message !== null
          ? JSON.stringify(message)
          : message.toString()

        logger.info(`     - ${jobName}-${stepName} - Child message 💬 ${messageString}`)
        if (typeof message === 'object' && !Array.isArray(message) && message !== null) {
          // @ts-ignore
          const { jobEnvironment, processEnvironment, output: stepOutputPart } = message
          // si es un objeto con keys string y values string
          if (jobEnvironment && typeof jobEnvironment === 'object' && !Array.isArray(jobEnvironment)
            && Object.values(jobEnvironment).every(value => typeof value === 'string')) {
            envsToSet.jobEnvironments = {
              ...envsToSet.jobEnvironments,
              ...jobEnvironment,
            }
          }
          // si es un objeto con keys string y values string
          if (processEnvironment && typeof processEnvironment === 'object' && !Array.isArray(processEnvironment)
            && Object.values(processEnvironment).every(value => typeof value === 'string')) {
            envsToSet.processEnvironments = {
              ...envsToSet.processEnvironments,
              ...processEnvironment,
            }
          }
          // si es un objeto con keys string y values string
          if (stepOutputPart && typeof stepOutputPart === 'object' && !Array.isArray(stepOutputPart)
            && Object.values(stepOutputPart).every(value => typeof value === 'string')) {
            outputToSet = {
              ...outputToSet,
              ...stepOutputPart,
            }
          }
        }
        registerStepStatus(collection, processId, jobName, stepIndex, 'message', messageString)
      })
      childProcess.on('exit', async code => {
        fs.closeSync(streamOut)
        logger.info(`     - ${jobName}-${stepName} - Child exited with code ${code}`)

        await setEnvironments(collection, processId, {
          jobName,
          jobEnvironments: envsToSet.jobEnvironments,
          processEnvironments: envsToSet.processEnvironments,
        })

        await setOutputEnvironments(collection, processId, {
          jobName,
          output,
          outputToSet,
        })

        if (code !== 0) {
          await registerStepStatus(collection, processId, jobName, stepIndex, 'error', `Child exited with code ${code}`)

          // reject(new Error(`Child exited with code ${code}`))
          resolve(false)
        } else {
          await registerStepStatus(collection, processId, jobName, stepIndex, 'completed', 'Child completed')

          resolve(true)
        }
      })
    })

    const result = await childProcessPromise
    return result
  }
  return true
}

/**
 * @param {Collection<import('./process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} jobName
 * @param {import('./process').Job} job
 */
const processJob = async (collection, processId, jobName, job) => {
  await setJobStatus(collection, processId, jobName, 'processing')

  const { steps } = job

  // eslint-disable-next-line no-restricted-syntax
  for (const step of steps) {
    logger.info(`   - ${jobName}-${step.name} - STARTING STEP`)
    const stepIndex = steps.findIndex(s => s.name === step.name)
    try {
      const success = await processStep(collection, processId, jobName, stepIndex, step)
      if (!success) {
        logger.info(`   - ${jobName}-${step.name} - STEP FAILED ❌`)
        await setJobStatus(collection, processId, jobName, 'failed')
        return false
      }
      logger.info(`   - ${jobName}-${step.name} - STEP COMPLETED ✅`)
    } catch (error) {
      logger.info(error, `${jobName} - Error caught in processStep 🆘`)
      await registerStepStatus(collection, processId, jobName, stepIndex, 'failed', error.message)
      await setJobStatus(collection, processId, jobName, 'failed')
      await registerProcessStatus(collection, processId, 'failed')
      // throw error
      return false
    }
  }

  logger.info(`   - ${jobName} - COMPLETED JOB 🚀`)
  await setJobStatus(collection, processId, jobName, 'completed')
  return true
}

/**
 * @param {Collection<import('./process').Process>} collection
 * @param {ObjectId} processId
 */
const processProceso = async (collection, processId) => {
  const isProcessCompleted = await verifyAllProcessJobsIsCompleted(collection, processId)
  if (isProcessCompleted) {
    logger.info(`COMPLETE PROCESS 🥳🎉 ${processId}`)
    await registerProcessStatus(collection, processId, 'completed')
    return true
  }
  const existFailedJobs = await verifyExistsProcessJobsFailed(collection, processId)
  if (existFailedJobs) {
    logger.info(`FAILED PROCESS 😥 ${processId}`)
    await registerProcessStatus(collection, processId, 'failed')
    return false
  }

  const jobsToProcess = await getJobsWithoutStoppers(collection, processId)
  if (jobsToProcess.length === 0) {
    throw new Error('No jobs to process are available and process is not completed and no failed jobs')
  }

  try {
    logger.info(` - STARTING JOBS - [${jobsToProcess.map(j => j.name).join(', ')}]`)
    const jobsPromises = jobsToProcess.map(job => processJob(collection, processId, job.name, job))
    await Promise.all(jobsPromises)
  } catch (error) {
    logger.error(error, 'Error caught in processJob 🆘')
    await registerProcessStatus(collection, processId, 'failed')
    return false
  }

  return processProceso(collection, processId)
}

async function main () {
  const queueProcessorId = QUEUE_PROCESSOR_ID
  await client.connect()
  logger.info({ queueProcessorId }, 'Connected successfully to db server')
  const db = client.db(dbName)
  /** @type {ReturnType<typeof db.collection<import('./process').Process>>} */
  const collection = db.collection('processesQueue')

  logger.info({ queueProcessorId }, `iniciando procesamiento en procesador: ${QUEUE_PROCESSOR_ID}`)
  logger.info({ queueProcessorId }, '---------------------------------------------')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const proceso = await buscarProcesoYActualizarEstado(collection)
      if (!proceso) {
        // logger.info('No process to process')
        await timeout(1000 * 5) // 5 seconds
        // eslint-disable-next-line no-continue
        continue
      }
      const processId = proceso._id

      logger.info({ processId: processId.toString(), queueProcessorId }, `STARTING PROCESS: ${processId} - 🛫 "${proceso.payload.name}" - cron: ${proceso.payload.cron}`)
      await loggerMiddleware(() => processProceso(collection, processId), processId.toString())
    } catch (error) {
      logger.error(error, 'Error caught in main loop 🆘')
    }
    await timeout(1000 * 5) // 5 seconds
  }

  return 'done.'
}

main()
  .then(result => {
    logger.info(result, 'Main done')

    client.close()
    logger.info('closing client connection and clearing cronjobs, bye 👋')
  })
  .catch(err => {
    logger.fatal(err, 'Error in main')

    client.close()
    logger.info('closing client connection and clearing cronjobs, bye 👋')

    process.exit(1)
  })

process.on('uncaughtException', error => {
  logger.fatal(error, 'There was an uncaught error')

  client.close()
  logger.info('closing client connection and clearing cronjobs, bye 👋')

  process.exit(1)
})

process.on('unhandledRejection', error => {
  logger.fatal(error, 'There was an unhandled rejection')

  client.close()
  logger.info('closing client connection and clearing cronjobs, bye 👋')

  process.exit(1)
})
