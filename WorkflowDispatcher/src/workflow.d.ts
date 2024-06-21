interface StepUses {
  name: string
  uses: string
  with?: {
    [key: string]: string
  }
  output?: {
    [key: string]: string
  }
}

interface StepFork {
  name: string
  workingDirectory: string
  fork: string
  env?: {
    [key: string]: string
  }
  output?: {
    [key: string]: string
  }
}

interface StepRun {
  name: string
  run: string
}

interface Job {
  description: string
  needs?: string | string[]
  steps: [StepUses | StepFork | StepRun]
}

export interface Workflow {
  name: string
  createdAt: Date
  modifiedAt: Date
  cron?: string
  status: 'active'|'inactive'
  jobs: {
    [key: string]: Job
  }
}