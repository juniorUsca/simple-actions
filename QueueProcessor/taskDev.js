const { ObjectId } = require('mongodb')

const taskDev = {
  // _id: { $oid: '664dbc13c8ec8a0d3d3348f4' },
  createdAt: new Date(),
  payload: {
    _id: new ObjectId('664db6cea7bb78058ad13861'),
    name: 'sftp_1',
    description: 'Download sftp',
    cron: '*/5 * * * * *',
    status: 'active',
    jobs: {
      downloadFile: {
        description: 'Descarga archivo de hoy',
        steps: [
          {
            name: 'checkout',
            uses: 'actions/navigateToProjectFolder',
            with: {
              path: '/Users/junior/apps/vendemas/reports-datalake',
            },
          },
          {
            name: 'downloadFile',
            uses: 'actions/downloadFile',
            with: {
              url: 'sftp://sftp.vendemas.com.ar:22',
              username: 'junior',
              password: '1234',
              path: '/Users/junior/apps/vendemas/reports-datalake',
              filename: 'file.csv',
            },
          },
        ],
      },
    },
    lastModified: new Date(),
  },
  sharedEnvironment: {
  },
  statuses: [
    {
      status: 'enqueued',
      timestamp: new Date(),
      processorId: '0001',
      nextReevaluation: null,
    },
  ],
  workflowId: new ObjectId('664db6cea7bb78058ad13861'),
  jobs: {
    downloadFile: {
      description: 'Descarga archivo de hoy',
      needs: [], // TODO
      status: 'pending', // pending, processing, completed, failed // TODO
      sharedEnvironment: {
        _ACTION_CWD: '', // TODO
        _ACTION_TMP: '/Users/junior/apps/vendemas/vmas-actions/tmp/', // TODO
      }, // TODO
      steps: [
        {
          name: 'generateFileNamePattern',
          fork: 'node generateName.js',
          workingDirectory: '/Users/junior/apps/vendemas/tasks/projects/h2h/batch-consumo/',
          env: {}, // TODO
          output: { // TODO
            filePattern: '$_job.TODAY_FILENAME_PATTERN',
          },
          statuses: [], // TODO
          logPath: '/Users/junior/apps/vendemas/vmas-actions/logs/generateFileNamePattern.log', // TODO
        },
        {
          name: 'downloadFile',
          uses: 'actions/downloadSftpFiles',
          with: {
            host: 's-5dac5aa113264ea0a.server.transfer.us-east-1.amazonaws.com',
            username: 'backoffice',
            password: '<bZgT7LF',
            filePatterns: '$_job.TODAY_FILENAME_PATTERN',
            // filePatterns: '^registroComerciosVendemas_20240523\\.csv$',
            remoteDirectory: '/s3-sftp-backoffice-vendemas/bi/H2H/',
            failIfNoFiles: 'true',
            // localDirectory: '',
          },
          output: { // TODO
            fileRoutes: '$_process.LOCAL_FILES_ROUTES',
          },
          statuses: [],
          logPath: '/Users/junior/apps/vendemas/vmas-actions/logs/downloadFile.log', // TODO
        },
        // {
        //   name: 'saveRoutes',
        //   uses: 'actions/setProcessEnv',
        //   with: {
        //     localFilesRoutes: '$_job._ACTION_DOWNLOAD_SFTP_FILES_FILES',
        //   },
        //   statuses: [], // TODO
        //   logPath: '/Users/junior/apps/vendemas/vmas-actions/logs/saveRoutes.log', // TODO
        // },
      ],
    },
    processFile: {
      description: 'Enviar archivos a procesar en .34',
      needs: [
        'downloadFile',
      ], // TODO
      status: 'pending', // pending, processing, completed, failed // TODO
      sharedEnvironment: {
        _ACTION_CWD: '', // TODO
        _ACTION_TMP: '/Users/junior/apps/vendemas/vmas-actions/tmp2/', // TODO
      }, // TODO
      steps: [
        {
          name: 'sendToReports',
          fork: 'node sendToReports.js',
          workingDirectory: '/Users/junior/apps/vendemas/tasks/projects/h2h/batch-consumo/',
          env: {
            server: '172.16.2.33',
            database: 'xzedi.reports',
            user: 'user_datacloud',
            password: 'JvwU27BBu9dzmSCx',
            fileRoutes: '$_process.LOCAL_FILES_ROUTES',
          }, // TODO
          output: {}, // TODO
          statuses: [], // TODO
          logPath: '/Users/junior/apps/vendemas/vmas-actions/logs/sendToReports.log', // TODO
        },
      ],
    },
  },
}

module.exports = {
  taskDev,
}
