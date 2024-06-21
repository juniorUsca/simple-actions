interface StepStatus {
  status: string
  timestamp: Date
  message: string | object
}

interface Step {
  name: string
  uses?: string
  with?: {
    [key: string]: string
  }
  run?: string
  fork?: string
  env?: {
    [key: string]: string
  }
  workingDirectory?: string
  statuses: StepStatus[]
  logPath: string
  output?: {
    [key: string]: string
  }
}

export interface Job {
  description: string
  needs: string[]
  status: 'pending'|'running'|'completed'|'failed'
  sharedEnvironment: {
    _ACTION_CWD: string // Current working directory of job
    _ACTION_TMP: string // Temporary directory of job
    [key: string]: string
  }
  steps: Step[]
}

interface ProcessStatus {
  status: string
  timestamp: Date
  processorId: string
  nextReevaluation: null | Date
}

export interface Process {
  createdAt: Date
  payload: any
  sharedEnvironment: {
    [key: string]: string
  }
  folderHash: string
  statuses: ProcessStatus[]
  workflowId: ObjectId
  jobs: {
    [key: string]: Job
  }
}