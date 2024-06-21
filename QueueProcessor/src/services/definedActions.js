const fs = require('node:fs')
const path = require('node:path')

const getDefinedActions = () => {
  const definedActions = fs.readdirSync('definedActions').map(folder => ({
    route: path.resolve(path.join('definedActions', folder)),
    index: path.resolve(path.join('definedActions', folder, 'index.js')),
    name: `actions/${folder}`,
  }))

  return definedActions
}

const definedActions = getDefinedActions()

const getActionInfo = actionName => definedActions.find(action => action.name === actionName)

module.exports = {
  definedActions,
  getDefinedActions,
  getActionInfo,
}
