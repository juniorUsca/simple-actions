/* eslint-disable no-await-in-loop */
const path = require('node:path')
const fs = require('node:fs')

const { MongoClient } = require('mongodb')
const { CronJob } = require('cron')

const {
  MONGO_DB, MONGO_URL, MAIN_TMP_FOLDER, MAIN_LOGS_FOLDER,
} = require('./consts')

const { sleep, paramNeedsToArray, generateProcessFolderHash } = require('./utils/utils')
const validateWorkflow = require('./validateWorkflow')

const { logger, loggerMiddleware } = require('./utils/logger')

// /** @typedef {import('./global')} */

const url = MONGO_URL
const client = new MongoClient(url)

// Database Name
const dbName = MONGO_DB

/** @type {Record<string, CronJob<null, { id: string }>>} */
const cronjobs = {}

/**
 * @param {string} id
 */
const deleteCronjob = id => {
  const cronjob = cronjobs[id]
  if (cronjob) {
    cronjob.stop()
    delete cronjobs[id]
    logger.info({ id }, 'cronjob eliminado')
  }
}

async function main () {
  await client.connect()
  logger.info('Connected successfully to db server')
  const db = client.db(dbName)
  /** @type {ReturnType<typeof db.collection<import('./workflow').Workflow>>} */
  const collectionWorkflows = db.collection('workflows')

  /** @type {ReturnType<typeof db.collection<import('../../QueueProcessor/src/process').Process>>} */
  const collectionQueue = db.collection('processesQueue')

  /**
   * @param {import('mongodb').WithId<import('./workflow').Workflow>} workflow
   */
  const startCronJob = workflow => {
    const { _id, cron, name } = workflow
    const id = _id.toString()
    if (!cron) {
      logger.warn(`workflow sin cron, id: ${id} name: ${name}`)
      return
    }
    if (!id) {
      logger.warn(`workflow sin id, name: ${name} cron: ${cron}`)
      return
    }

    const onTick = async () => {
      const currentWorkflow = await collectionWorkflows.findOne({ _id })
      if (!currentWorkflow) {
        logger.warn('currentWorkflow no encontrado onTick')

        deleteCronjob(id)
        return
      }

      const validWorkflow = validateWorkflow(currentWorkflow)
      if (!validWorkflow) {
        logger.warn(`workflow invalido 🤬 "${name}" - ${id}`)
        return
      }

      const processFolderHash = generateProcessFolderHash()

      // transform jobs of Workflow to jobs of Process
      const processJobs = Object.keys(workflow.jobs).reduce((acc, jobName) => {
        const workflowJob = workflow.jobs[jobName]
        fs.mkdirSync(path.join(MAIN_TMP_FOLDER ?? '', processFolderHash, jobName), { recursive: true })
        fs.mkdirSync(path.join(MAIN_LOGS_FOLDER ?? '', processFolderHash, jobName), { recursive: true })

        /** @type {import('../../QueueProcessor/src/process').Job} */
        const processJob = {
          description: workflowJob.description,
          needs: paramNeedsToArray(workflowJob.needs),
          status: 'pending', // default status pending // pending, processing, completed, failed
          sharedEnvironment: {
            _ACTION_CWD: '',
            _ACTION_TMP: path.join(MAIN_TMP_FOLDER ?? '', processFolderHash, jobName),
          },
          steps: workflowJob.steps.map(workflowStep => {
            const stepLogPath = path.join(MAIN_LOGS_FOLDER ?? '', processFolderHash, jobName, `${workflowStep.name}.log`)
            if ('uses' in workflowStep) {
              return {
                name: workflowStep.name,
                uses: workflowStep.uses,
                with: workflowStep.with || {},
                output: workflowStep.output || {},
                statuses: [],
                logPath: stepLogPath,
              }
            }
            if ('fork' in workflowStep) {
              return {
                name: workflowStep.name,
                fork: workflowStep.fork,
                workingDirectory: workflowStep.workingDirectory,
                env: workflowStep.env || {},
                output: workflowStep.output || {},
                statuses: [],
                logPath: stepLogPath,
              }
            }
            // run type
            return {
              name: workflowStep.name,
              run: workflowStep.run,
              statuses: [],
              logPath: stepLogPath,
            }
          }),
        }
        acc[jobName] = processJob
        return acc
      }, {})

      const nuevoProceso = await collectionQueue.insertOne({
        createdAt: new Date(),
        payload: workflow,
        sharedEnvironment: {},
        folderHash: processFolderHash,
        statuses: [
          {
            status: 'enqueued',
            timestamp: new Date(),
            processorId: '-',
            nextReevaluation: null,
          },
        ],
        workflowId: _id,
        jobs: processJobs,
      })
      logger.info(` 🌟 El workflow: ${id} - "${name}" ${cron}, encoló un nuevo proceso ${nuevoProceso.insertedId.toString()}`)
    }

    const cronjob = CronJob.from({
      cronTime: cron,
      onTick,
      start: false,
      timeZone: 'America/Lima',
      context: { id },
    })

    if (cronjobs[id]) {
      cronjobs[id].stop()
    }

    cronjob.start()
    cronjobs[id] = cronjob

    logger.info(`cronjob iniciado ${_id} - "${name}" ${cron}`)
    logger.info(`    next execution ${cronjob.nextDate().toString()}`)
  }

  const startDate = new Date()
  let endDate = new Date()
  const workflows = await collectionWorkflows.find({
    cron: { $exists: true },
    status: 'active',
    modifiedAt: { $lt: startDate },
  }).toArray()

  logger.info(`se iniciaran ${workflows.length} cronjobs`)
  workflows.forEach(workflow => {
    loggerMiddleware(() => startCronJob(workflow), workflow._id.toString())
  })

  logger.info('----- iniciando escucha de cambios 🎶🎵🎼 -----')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    endDate = new Date()
    const changes = await collectionWorkflows.find({
      status: 'active',
      cron: { $exists: true },
      // modifiedAt: { $gte: startDate, $lt: endDate },
      modifiedAt: { $lt: endDate },
    }).toArray()
    // const workflows = await collectionWorkflows.find({
    //   cron: { $exists: true },
    //   status: 'active',
    //   modifiedAt: { $lt: startDate },
    // }).toArray()
    // startDate = endDate

    // list of new workflows
    const newWorkflows = changes.filter(workflow => !cronjobs[workflow._id.toString()])
    // list of updated workflows
    const updatedWorkflows = changes.filter(workflow => {
      const cronjob = cronjobs[workflow._id.toString()]
      if (!cronjob) {
        return false
      }
      return cronjob.cronTime.source !== workflow.cron
    })
    // list of deleted or inactive workflows
    const deletedWorkflows = Object.keys(cronjobs)
      .filter(id => !changes.find(workflow => workflow._id.toString() === id))

    newWorkflows.forEach(workflow => {
      const workflowId = workflow._id.toString()
      logger.info({ workflowId }, `cronjob nuevo ${workflowId} - "${workflow.name}" ${workflow.cron}`)
      loggerMiddleware(() => startCronJob(workflow), workflowId)
    })

    updatedWorkflows.forEach(workflow => {
      const workflowId = workflow._id.toString()
      logger.info({ workflowId }, `cronjob por actualizar ${workflowId} - "${workflow.name}" ${workflow.cron}`)
      loggerMiddleware(() => startCronJob(workflow), workflowId)
    })

    deletedWorkflows.forEach(id => {
      loggerMiddleware(() => deleteCronjob(id), id)
    })

    await sleep(1000 * 60) // 1 minute
  }

  // eslint-disable-next-line no-restricted-syntax
  // for await (const change of collection.watch()) {
  //   // logger.info('change', change)
  //   if (change.operationType === 'insert') {
  //     const { _id } = change.documentKey
  //     const workflow = change.fullDocument
  //     // logger.info('workflow', workflow)
  //     const { name, cron, status } = workflow

  //     if (status === 'active') {
  //       const cronjob = CronJob.from({
  //         cronTime: cron,
  //         onTick,
  //         start: false,
  //         timeZone: 'America/Lima',
  //         context: { _id },
  //       })

  //       cronjob.start()

  //       if (cronjobs[_id]) {
  //         cronjobs[_id].stop()
  //       }
  //       cronjobs[_id] = cronjob

  //       logger.info('cronjob nuevo', name, _id, cron)
  //     }
  //   }

  //   if (change.operationType === 'update') {
  //     const { updatedFields } = change.updateDescription
  //     const { _id } = change.documentKey

  //     if (updatedFields?.cron || updatedFields?.status) {
  //       const workflow = await collection.findOne({ _id })

  //       const oldCronjob = cronjobs[_id]
  //       if (oldCronjob) {
  //         oldCronjob.stop()
  //         delete cronjobs[_id]
  //       }

  //       if (workflow?.status === 'active' && workflow?.cron) {
  //         const { cron, name } = workflow
  //         const cronjob = CronJob.from({
  //           cronTime: cron,
  //           onTick,
  //           start: false,
  //           timeZone: 'America/Lima',
  //           context: { _id },
  //         })

  //         cronjob.start()
  //         cronjobs[_id] = cronjob

  //         logger.info('cronjob actualizado', name, _id, cron)
  //       } else {
  //         logger.info('cronjob detenido por cambio de estado a inactivo', _id)
  //       }
  //     }
  //   }

  //   if (change.operationType === 'delete') {
  //     const { _id } = change.documentKey
  //     // logger.info('delete', _id)
  //     const cronjob = cronjobs[_id]
  //     if (cronjob) {
  //       cronjob.stop()
  //       delete cronjobs[_id]

  //       logger.info('cronjob eliminado', _id)
  //     }
  //   }
  // }

  return 'done.'
}

main()
  .then(result => {
    logger.info(result, 'Main done')
    Object.values(cronjobs).forEach(cronjob => {
      cronjob.stop()
    })
    client.close()
    logger.info('closing client connection and clearing cronjobs, bye 👋')
  })
  .catch(err => {
    logger.fatal(err, 'Error in main')
    Object.values(cronjobs).forEach(cronjob => {
      cronjob.stop()
    })
    client.close()
    logger.info('closing client connection and clearing cronjobs, bye 👋')

    process.exit(1)
  })

process.on('uncaughtException', error => {
  logger.fatal(error, 'There was an uncaught error')

  Object.values(cronjobs).forEach(cronjob => {
    cronjob.stop()
  })
  client.close()
  logger.info('closing client connection and clearing cronjobs, bye 👋')

  process.exit(1)
})

process.on('unhandledRejection', error => {
  logger.fatal(error, 'There was an unhandled rejection')

  Object.values(cronjobs).forEach(cronjob => {
    cronjob.stop()
  })
  client.close()
  logger.info('closing client connection and clearing cronjobs, bye 👋')

  process.exit(1)
})
