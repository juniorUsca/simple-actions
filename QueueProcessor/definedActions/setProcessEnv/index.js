const WITH_JSON_STRING = process.env.with ?? '{}'

const withParams = JSON.parse(WITH_JSON_STRING)

console.log('setting process env', WITH_JSON_STRING)

process.send?.({
  processEnvironment: {
    ...withParams,
  },
})
