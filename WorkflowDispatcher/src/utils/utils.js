const crypto = require('node:crypto')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('America/Lima')

/**
 * @param {number} ms
 */
function timeout (ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * @param {string | string[] | null | undefined} needs
 */
function paramNeedsToArray (needs) {
  if (!needs) {
    return []
  }
  if (Array.isArray(needs)) {
    return needs
  }
  return [needs]
}

function generateProcessFolderHash () {
  const todayFormat = dayjs().format('YYYY-MM-DD_HH-mm-ss')
  const uuid = crypto.randomUUID()
  return `${todayFormat}_${uuid}`
}

/**
 * @param {Record<string, any>} obj
 */
function isFlatObject (obj) {
  // eslint-disable-next-line no-restricted-syntax
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      return false
    }
  }
  return true
}

/**
 * @param {Record<string, any>} obj
 */
function areAllValuesStrings (obj) {
  // eslint-disable-next-line no-restricted-syntax
  for (const key in obj) {
    if (typeof obj[key] !== 'string') {
      return false
    }
  }
  return true
}

module.exports = {
  timeout,
  sleep: timeout,

  paramNeedsToArray,
  generateProcessFolderHash,

  isFlatObject,
  areAllValuesStrings,
}
