/* eslint-disable guard-for-in */
const fs = require('node:fs')
const { paramNeedsToArray, isFlatObject, areAllValuesStrings } = require('./utils/utils')

const { logger } = require('./utils/logger')

/**
 * @param {import('mongodb').WithId<import('./workflow').Workflow>} workflow
 */
const validateWorkflow = workflow => {
  const {
    _id, cron, name: workflowName, createdAt, modifiedAt, status,
  } = workflow
  if (!_id) {
    logger.warn(`🚫 workflow sin id ${workflowName} ${cron}`)
    return false
  }
  if (!workflowName) {
    logger.warn(`🚫 workflow sin name ${_id} ${cron}`)
    return false
  }
  if (!cron) {
    logger.warn(`🚫 workflow sin cron ${workflowName} ${_id}`)
    return false
  }
  if (!createdAt) {
    logger.warn(`🚫 workflow sin createdAt ${workflowName} ${_id}`)
    return false
  }

  if (!modifiedAt) {
    logger.warn(`🚫 workflow sin modifiedAt ${workflowName} ${_id}`)
  }
  if (status !== 'active') {
    logger.warn(`🚫 workflow inactivo ${workflowName} ${_id}`)
  }

  // validación de jobs
  if (!workflow.jobs) {
    logger.warn(`🚫 workflow sin jobs ${workflowName} ${_id}`)
    return false
  }
  const { jobs } = workflow

  // eslint-disable-next-line no-restricted-syntax
  for (const jobName in jobs) {
    const job = jobs[jobName]
    if (!job) {
      logger.warn(`🚫 job sin datos ${jobName} ${workflowName} ${_id}`)
      return false
    }

    if (!job.description) {
      logger.warn(`🚫 job sin description ${jobName} ${workflowName} ${_id}`)
      return false
    }
    if (typeof job.needs !== 'string' && !Array.isArray(job.needs) && job.needs !== null && job.needs !== undefined) {
      logger.warn(`🚫 job NEEDS no es un string, array, null o undefined ${jobName} ${workflowName} ${_id}`)
      return false
    }

    const needs = paramNeedsToArray(job.needs)
    const existNeeds = needs.every(need => jobs[need])
    if (!existNeeds) {
      logger.warn(`🚫 job con needs inexistentes ${needs} ${jobName} ${workflowName} ${_id}`)
      return false
    }

    if (!job.steps) {
      logger.warn(`🚫 job sin steps ${jobName} ${workflowName} ${_id}`)
      return false
    }

    // validacion de steps
    const { steps } = job
    // eslint-disable-next-line no-restricted-syntax
    for (const step of steps) {
      if (!step) {
        logger.warn(`🚫 step sin datos ${step} ${jobName} ${workflowName} ${_id}`)
        return false
      }
      if (!step.name) {
        logger.warn(`🚫 step sin name ${jobName} ${workflowName} ${_id}`)
        return false
      }
      const stepName = step.name

      if ('uses' in step) {
        if (typeof step.uses !== 'string') {
          logger.warn(`🚫 step USES no es un string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        // verify is uses valid
        const definedActions = fs.readdirSync('../QueueProcessor/definedActions')
        const action = definedActions.find(definedAction => `actions/${definedAction}` === step.uses)
        if (!action) {
          logger.warn(`🚫 step USES inexistente ${step.uses} ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        const withParams = step.with || {}
        if (!isFlatObject(withParams)) {
          logger.warn(`🚫 step WITH no es un objeto plano ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
        if (!areAllValuesStrings(withParams)) {
          logger.warn(`🚫 step WITH no tiene todos los valores de tipo string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        const output = step.output || {}
        if (!isFlatObject(output)) {
          logger.warn(`🚫 step OUTPUT no es un objeto plano ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
        if (!areAllValuesStrings(output)) {
          logger.warn(`🚫 step OUTPUT no tiene todos los valores de tipo string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
      } else if ('fork' in step) {
        if (typeof step.fork !== 'string') {
          logger.warn(`🚫 step FORK no es un string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
        if (!step.fork.startsWith('node ')) {
          logger.warn(`🚫 step FORK no empieza con "node " ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        if (!step.workingDirectory) {
          logger.warn(`🚫 step FORK sin workingDirectory ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        const envParams = step.env || {}
        if (!isFlatObject(envParams)) {
          logger.warn(`🚫 step FORK env no es un objeto plano ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
        if (!areAllValuesStrings(envParams)) {
          logger.warn(`🚫 step FORK env no tiene todos los valores de tipo string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }

        const output = step.output || {}
        if (!isFlatObject(output)) {
          logger.warn(`🚫 step OUTPUT no es un objeto plano ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
        if (!areAllValuesStrings(output)) {
          logger.warn(`🚫 step OUTPUT no tiene todos los valores de tipo string ${stepName} ${jobName} ${workflowName} ${_id}`)
          return false
        }
      } else if ('run' in step) {
        logger.warn(`🚫 step no soportado aún ${stepName} ${jobName} ${workflowName} ${_id}`)
        return false
      } else {
        logger.warn(`🚫 step no soportado (debe tener uses, fork o run) ${stepName} ${jobName} ${workflowName} ${_id}`)
        return false
      }
    }
  }

  return true
}

module.exports = validateWorkflow
