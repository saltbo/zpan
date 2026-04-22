@description('Application name — used as a prefix for all resources.')
param appName string = 'zpan'

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Turso (libSQL) database URL, e.g. libsql://your-db.turso.io')
param tursoDatabaseUrl string

@secure()
@description('Turso auth token.')
param tursoAuthToken string

// Unique suffix derived from the resource group so re-runs produce the same names (idempotent).
var suffix = uniqueString(resourceGroup().id)
var storageAccountName = take('${toLower(replace(appName, '-', ''))}${suffix}', 24)
var hostingPlanName = '${appName}-plan-${suffix}'
var functionAppName = '${appName}-func-${suffix}'

// ---------------------------------------------------------------------------
// Storage Account — required by the Azure Functions runtime.
// ---------------------------------------------------------------------------
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// ---------------------------------------------------------------------------
// Consumption plan (Y1 / Dynamic SKU).
// ---------------------------------------------------------------------------
resource hostingPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: hostingPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

// ---------------------------------------------------------------------------
// Function App — Node 22, programming model v4.
// BETTER_AUTH_SECRET is intentionally absent here; it is managed by the
// deploy workflow so that it is generated once and never overwritten on
// subsequent runs.
// ---------------------------------------------------------------------------
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      nodeVersion: '~22'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'TURSO_DATABASE_URL', value: tursoDatabaseUrl }
        { name: 'TURSO_AUTH_TOKEN', value: tursoAuthToken }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs consumed by the deploy workflow.
// ---------------------------------------------------------------------------
@description('Name of the deployed Function App.')
output functionAppName string = functionApp.name

@description('Default HTTPS URL of the Function App.')
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
