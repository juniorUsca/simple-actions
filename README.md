# SIMPLE-ACTIONS

```
# WorkflowDispatcher Configuration

# generate folders, example
mkdir -p workflow-outputs/tmp
mkdir -p workflow-outputs/logs
mkdir -p workflow-outputs/results

cd WorkflowDispatcher
pnpm install

cp .env.sample .env
# edit .env
code .env

pm2 start pm2.config.js

## QueueProcessor Configuration

cd QueueProcessor
pnpm install

cp .env.sample .env
# edit .env
code .env

cd definedActions/downloadSftpFiles
pnpm install

cd ../../
cd definedActions/clearSftpFiles
pnpm install

cd ../../
pm2 start pm2.config.js

```
