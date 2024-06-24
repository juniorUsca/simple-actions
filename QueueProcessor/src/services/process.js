const { MongoClient } = require('mongodb')
const { Collection, ObjectId } = require('mongodb')

const { QUEUE_PROCESSOR_ID } = require('../consts')

/**
 * @param {Collection<import('../process').Process>} collection
 */
const buscarProcesoYActualizarEstado = async collection => collection.findOneAndUpdate({
  $and: [
    {
      'statuses.0.status': 'enqueued',
      'statuses.0.nextReevaluation': null,
    },
  ],
}, {
  $push: {
    statuses: {
      $each: [
        {
          status: 'processing',
          processorId: QUEUE_PROCESSOR_ID,
          timestamp: new Date(),
          nextReevaluation: null,
        },
      ],
      $position: 0,
    },
  },
}, {
  returnDocument: 'after',
  sort: { createdAt: 1 },
})

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 */
const getJobsWithoutStoppers = async (collection, processId) => {
  const proceso = await collection.findOne({ _id: processId })
  if (!proceso) {
    throw new Error('Process not found')
  }
  const { jobs } = proceso

  const jobsWithoutStoppers = []

  const pendingJobs = Object.keys(jobs).filter(jobName => jobs[jobName].status === 'pending')

  // eslint-disable-next-line no-restricted-syntax
  for (const jobName of pendingJobs) {
    const job = jobs[jobName]
    const { needs } = job
    // verify needs are completed
    const needsCompleted = needs.every(need => jobs[need].status === 'completed')
    if (needsCompleted) {
      jobsWithoutStoppers.push({
        ...job,
        name: jobName,
      })
    }
  }
  return jobsWithoutStoppers
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 */
const verifyAllProcessJobsIsCompleted = async (collection, processId) => {
  const proceso = await collection.findOne({ _id: processId })
  if (!proceso) {
    throw new Error('Process not found')
  }
  const { jobs } = proceso

  let isProcessCompleted = true
  // eslint-disable-next-line no-restricted-syntax, guard-for-in
  for (const jobName in jobs) {
    const job = jobs[jobName]
    if (job.status !== 'completed') {
      isProcessCompleted = false
      break
    }
  }

  return isProcessCompleted
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 */
const verifyExistsProcessJobsFailed = async (collection, processId) => {
  const proceso = await collection.findOne({ _id: processId })
  if (!proceso) {
    throw new Error('Process not found')
  }
  const { jobs } = proceso

  let existsFailedJob = false
  // eslint-disable-next-line no-restricted-syntax, guard-for-in
  for (const jobName in jobs) {
    const job = jobs[jobName]
    if (job.status === 'failed') {
      existsFailedJob = true
      break
    }
  }

  return existsFailedJob
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} status
 */
const registerProcessStatus = async (collection, processId, status) => {
  await collection.updateOne({ _id: processId }, {
    $push: {
      statuses: {
        $each: [
          {
            status,
            processorId: PROCESSOR_ID,
            timestamp: new Date(),
            nextReevaluation: null,
          },
        ],
        $position: 0,
      },
    },
  })
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} jobName
 * @param {'pending'|'processing'|'completed'|'failed'} status
 */
const setJobStatus = async (collection, processId, jobName, status) => {
  await collection.updateOne({ _id: processId }, {
    $set: {
      [`jobs.${jobName}.status`]: status,
    },
  })
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} job
 * @param {number} stepPosition
 * @param {string} status
 * @param {string} message
 */
const registerStepStatus = async (collection, processId, job, stepPosition, status, message) => {
  await collection.updateOne({ _id: processId }, {
    $push: {
      [`jobs.${job}.steps.${stepPosition}.statuses`]: {
        $each: [
          {
            status,
            timestamp: new Date(),
            message,
          },
        ],
        $position: 0,
      },
    },
  })
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {string} jobName
 */
const getEnvironments = async (collection, processId, jobName) => {
  const procesoEnvironments = await collection.findOne({ _id: processId }, {
    projection: {
      sharedEnvironment: 1,
      [`jobs.${jobName}.sharedEnvironment`]: 1,
    },
  })
  if (!procesoEnvironments) {
    throw new Error('Process not found')
  }

  return {
    procesoEnvironments: procesoEnvironments.sharedEnvironment,
    jobEnvironments: procesoEnvironments.jobs[jobName].sharedEnvironment,
  }
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {object} options
 * @param {string?} options.jobName
 * @param {Record<string, string>?} options.jobEnvironments
 * @param {Record<string, string>?} options.processEnvironments
 */
const setEnvironments = async (collection, processId, { jobName, jobEnvironments, processEnvironments }) => {
  const set = {}
  if (!jobName && !jobEnvironments && !processEnvironments) {
    return false
  }

  if (jobName && jobEnvironments) {
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in jobEnvironments) {
      set[`jobs.${jobName}.sharedEnvironment.${key}`] = jobEnvironments[key]
    }
  }

  if (processEnvironments) {
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in processEnvironments) {
      set[`sharedEnvironment.${key}`] = processEnvironments[key]
    }
  }

  await collection.updateOne({ _id: processId }, {
    $set: set,
  })
  return true
}

/**
 * @param {Collection<import('../process').Process>} collection
 * @param {ObjectId} processId
 * @param {object} options
 * @param {string?} options.jobName
 * @param {Record<string, string> | undefined} options.output
 * @param {Record<string, string>} options.outputToSet
 */
const setOutputEnvironments = async (collection, processId, { jobName, output, outputToSet }) => {
  const set = {}
  if (!jobName || !output || !outputToSet) {
    return false
  }

  // eslint-disable-next-line guard-for-in, no-restricted-syntax
  for (const key in output) {
    const outputKey = key
    const actions = output[key].split(',')

    actions.forEach(action => {
      if (action.startsWith('$_job.')) {
        const jobEnvironmentKey = action.replace('$_job.', '')
        const jobEnvironmentValue = outputToSet[outputKey]

        if (jobEnvironmentValue) {
          set[`jobs.${jobName}.sharedEnvironment.${jobEnvironmentKey}`] = jobEnvironmentValue
        }
      }
      if (action.startsWith('$_process.')) {
        const processEnvironmentKey = action.replace('$_process.', '')
        const processEnvironmentValue = outputToSet[outputKey]

        if (processEnvironmentValue) {
          set[`sharedEnvironment.${processEnvironmentKey}`] = processEnvironmentValue
        }
      }
    })
  }

  await collection.updateOne({ _id: processId }, {
    $set: set,
  })
  return true
}

module.exports = {
  buscarProcesoYActualizarEstado,
  getJobsWithoutStoppers,
  verifyAllProcessJobsIsCompleted,
  verifyExistsProcessJobsFailed,
  registerProcessStatus,
  registerStepStatus,
  setJobStatus,
  getEnvironments,
  setEnvironments,
  setOutputEnvironments,
}
