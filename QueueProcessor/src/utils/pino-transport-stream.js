const { once } = require('node:events')
const { constants } = require('node:fs')
const {
  readdir, unlink, access, mkdir,
} = require('node:fs/promises')
const { join } = require('node:path')
const build = require('pino-abstract-transport')

const { prettyFactory } = require('pino-pretty')
const { SonicBoom } = require('sonic-boom')

const fsConstants = constants

// guía: https://github.com/ChatSift/utilities/blob/main/packages/pino-rotate-file/src/index.ts

// Their typings don't include prettyFactory for whatever reason
// declare module 'pino-pretty' {
// export function prettyFactory(options?: PrettyOptions): (chunk: Record<string, any>) => string;
// }

const ONE_DAY = 24 * 60 * 60 * 1_000
const PERU_OFFSET = 5 * 60 * 60 * 1_000
// var PERU_OFFSET = (new Date()).getTimezoneOffset() * 60000

const DEFAULT_MAX_AGE_DAYS = 365

// export type PinoRotateFileOptions = {
// dir: string;
// maxAgeDays?: number;
// mkdir?: boolean;
// prettyOptions?: PrettyOptions;
// };

// type Dest = {
// path: string;
// stream: SonicBoom;
// };

/**
 * Options for the transport
 * @param {string | number | Date} time - time en UTC para el nombre del archivo
 * @param {string} [prefix]
 */
function createFileName (time, prefix) {
  const dateUtc = new Date(time).getTime()

  // se atrasa hacia el timezone de Perú -5h para que el nombre del archivo
  // salga con fecha de Perú
  return `${prefix || ''}${new Date(dateUtc - PERU_OFFSET).toISOString().split('T')[0]}.log`
}

/**
 * @param {import("fs").PathLike} dir
 * @param {number} maxAgeDays
 * @param {string} filePrefix
 */
async function cleanup (dir, maxAgeDays, filePrefix = '') {
  const files = await readdir(dir)
  const promises = []

  // eslint-disable-next-line no-restricted-syntax
  for (const file of files) {
    if (!file.endsWith('.log')) {
      // eslint-disable-next-line no-continue
      continue
    }
    // file = '2023-08-17.log'
    if (!filePrefix && file.length !== 14) {
      // eslint-disable-next-line no-continue
      continue
    }
    if (filePrefix && !file.startsWith(filePrefix)) {
      // eslint-disable-next-line no-continue
      continue
    }

    const dateUtc = new Date(file.replace(filePrefix, '').split('.')[0]).getTime()
    // se incrementa el timezone de Perú
    // para que llegue al utc real
    // ya que el nombre del archivo está en utc-5
    const date = new Date((dateUtc * 1) + (PERU_OFFSET)).getTime()
    const now = Date.now()

    if (now - date >= maxAgeDays * ONE_DAY) {
      // @ts-ignore
      promises.push(unlink(join(dir, file)))
    }
  }

  await Promise.all(promises)
}

/**
 * @param {string} path
 */
async function createDest (path) {
  const stream = new SonicBoom({ dest: path })
  await once(stream, 'ready')

  return {
    path,
    stream,
  }
}

// @ts-ignore
async function endStream (stream) {
  stream.end()
  await once(stream, 'close')
}

/**
 * @param {{
 * prettyOptions: import("pino-pretty").PrettyOptions
 * mkdir: any
 * dir: import("fs").PathLike; maxAgeDays: any
 * filePrefix: string
 * }} options
 */
async function pinoRotateFile (options) {
  const pretty = options.prettyOptions ? prettyFactory(options.prettyOptions) : null

  if (options.mkdir) {
    try {
      await access(options.dir, fsConstants.F_OK)
    } catch {
      await mkdir(options.dir, { recursive: true })
    }
  }

  // eslint-disable-next-line no-bitwise
  await access(options.dir, fsConstants.R_OK | fsConstants.W_OK)
  await cleanup(options.dir, options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS, options.filePrefix)

  // @ts-ignore
  let dest = await createDest(join(options.dir, createFileName(Date.now(), options.filePrefix)))
  // @ts-ignore
  return build(
    async (/** @type {any} */ source) => {
      // eslint-disable-next-line no-restricted-syntax
      for await (const payload of source) {
        // @ts-ignore
        const path = join(options.dir, createFileName(Date.now(), options.filePrefix))
        if (dest.path !== path) {
          await cleanup(options.dir, options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS, options.filePrefix)
          await endStream(dest.stream)
          dest = await createDest(path)
        }

        const toDrain = !dest.stream.write(pretty?.(payload) ?? `${JSON.stringify(payload)}\n`)
        if (toDrain) {
          await once(dest.stream, 'drain')
        }
      }
    },
    {
      close: async () => {
        await cleanup(options.dir, options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS, options.filePrefix)
        await endStream(dest.stream)
      },
    },
  )
}

// export default pinoRotateFile
module.exports = pinoRotateFile
