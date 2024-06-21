import { Client } from 'ssh2'
import path from 'node:path'

const { _ACTION_TMP } = process.env

const REMOTE_DIR = process.env.remoteDirectory
const LOCAL_DIR = process.env.localDirectory ?? _ACTION_TMP
const HOST = process.env.host
const USERNAME = process.env.username
const PASSWORD = process.env.password
const FILE_PATTERNS = process.env.filePatterns ?? ''
const FAIL_IF_NO_FILES = process.env.failIfNoFiles ?? 'false'

if (!REMOTE_DIR) {
  throw new Error('remoteDirectory is required')
}
if (!LOCAL_DIR) {
  throw new Error('localDirectory is required')
}
if (!HOST || !USERNAME) {
  throw new Error('host and username are required')
}
if (!FILE_PATTERNS) {
  throw new Error('filesPatterns is required')
}
if (FAIL_IF_NO_FILES !== 'true' && FAIL_IF_NO_FILES !== 'false') {
  throw new Error('failIfNoFiles must be true or false. Default is false')
}

const filesPatternsToDownload = FILE_PATTERNS
  .split(',')
  .map(item => new RegExp(item.trim()))
const failIfNoFiles = FAIL_IF_NO_FILES === 'true'

/** @type {import('ssh2').ConnectConfig} */
const credentials = {
  host: HOST,
  username: USERNAME,
  password: PASSWORD,
}

console.log(`Se intentará descargar los archivos con los siguientes patrones: ${FILE_PATTERNS}`)

const conn = new Client()
conn.on('ready', () => {
  console.log('SFTP Client :: ready')
  conn.sftp((err, sftp) => {
    if (err) throw err

    sftp.readdir(REMOTE_DIR, (errReadDir, allFiles) => {
      if (errReadDir) {
        conn.end()
        throw errReadDir
      }

      /** @type {import('ssh2').FileEntryWithStats[]} */
      const listaADescargar = []
      filesPatternsToDownload.forEach(filePattern => {
        const files = allFiles.filter(item => item.filename.match(filePattern) !== null)

        if (files.length === 0 && failIfNoFiles) {
          console.log('No se encontraron los archivos en el directorio remoto con el patrón:', filePattern)
          console.log('Archivos en directorio:', allFiles.map(item => item.filename).join(', '))
          conn.end()
          throw new Error('No se encontraron los archivos en el directorio remoto')
        }

        listaADescargar.push(...files)
      })

      process.send?.({
        output: {
          fileNames: listaADescargar.map(item => item.filename).join(','),
          fileRoutes: listaADescargar.map(item => path.join(LOCAL_DIR, item.filename)).join(','),
        },
      })
      console.log('Archivos encontrados con los patrones:', listaADescargar.map(item => item.filename).join(', '))

      let count = listaADescargar.length
      listaADescargar.forEach(item => {
        const remoteFile = path.posix.join(REMOTE_DIR, item.filename)
        const localFile = path.join(LOCAL_DIR, item.filename)
        console.log(`Downloading ${remoteFile}`)

        // victor download method
        // sftp.readFile(remoteFile, (err, data) => {
        //   if (err) throw err
        //   fs.writeFile(localFile, data, (err) => {
        //     if (err) throw err
        //     console.log('Downloaded to ' + localFile)
        //     count--
        //     if (count <= 0) {
        //       conn.end()
        //     }
        //   })
        // })

        // download file using stream
        // const wtr = fs.createWriteStream(localFile, { autoClose: true })
        // const rdr = sftp.createReadStream(remoteFile, { autoClose: true })
        // rdr.once('error', (err) => {
        //   console.error('Error downloading file: ' + err)
        //   count--
        //   if (count <= 0) {
        //     conn.end()
        //   }
        // })
        // wtr.once('error', (err) => {
        //   console.error('Error writing file: ' + err)
        //   count--
        //   if (count <= 0) {
        //     conn.end()
        //   }
        // })
        // rdr.once('end', () => {
        //   console.log('Downloaded to ' + localFile)
        //   count--
        //   if (count <= 0) {
        //     conn.end()
        //   }
        // })
        // rdr.pipe(wtr)

        // normal download
        sftp.fastGet(remoteFile, localFile, errFastGet => {
          if (errFastGet) {
            console.log(`Error downloading file: ${remoteFile} to ${localFile}`)
            conn.end()
            throw errFastGet
          }
          console.log(`Downloaded to ${localFile}`)
          count--
          if (count <= 0) {
            conn.end()
          }
        })
      })
    })
  })
})
conn.on('error', err => {
  console.error(`Error caught, ${err}`)
  throw err
})
conn.connect(credentials)
