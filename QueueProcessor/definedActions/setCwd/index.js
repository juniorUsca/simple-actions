import path from 'node:path'

// console.log('Navigate to project folder')
// console.log(path.resolve('.'))

// console.log(process.env)

// setTimeout(() => {
//   console.log('completed task')
//   console.error('logging error')
// }, 6000)

// setTimeout(() => {
//   console.log('error on task')
//   throw new Error('mi error')
// }, 2000)

const newPath = process.env.path

if (!newPath) {
  throw new Error('path is required')
}

console.log('setting cwd to', newPath)

process.send?.({
  jobEnvironment: {
    _ACTION_CWD: newPath,
  },
})

// throw new Error('simple error')
