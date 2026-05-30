import { dequeuePendingOperations, markSyncOperationCompleted, markSyncOperationFailed, clearFailedOperations } from './syncQueue.js'
import { logSync, logErr } from './logger.js'
import { sendEmail } from './smtp/index.js'

// Startup sync: replay pending sync operations on app start
export async function replayPendingSyncOperations(imapClients) {
  logSync('[StartupSync] Starting replay of pending sync operations...')

  // Clear operations that have failed too many times
  clearFailedOperations()

  const pendingOperations = dequeuePendingOperations()
  if (pendingOperations.length === 0) {
    logSync('[StartupSync] No pending sync operations')
    return
  }

  logSync(`[StartupSync] Found ${pendingOperations.length} pending operations`)

  for (const op of pendingOperations) {
    try {
      await processSyncOperation(op, imapClients)
      markSyncOperationCompleted(op.id)
      logSync(`[StartupSync] Completed ${op.operation} for ${op.target_type}`)
    } catch (err) {
      logErr(`[StartupSync] Failed ${op.operation} for ${op.target_type}: ${err.message}`)
      markSyncOperationFailed(op.id, err.message)
    }
  }

  logSync('[StartupSync] Completed replay of pending sync operations')
}

async function processSyncOperation(operation, imapClients) {
  const { operation: opType, target_type, data, account_email, folder, uid } = operation

  switch (opType) {
    case 'setFlags':
      await processSetFlags(data, account_email, folder, uid, imapClients)
      break

    case 'moveMessage':
      await processMoveMessage(data, account_email, folder, uid, imapClients)
      break

    case 'deleteMessage':
      await processDeleteMessage(data, account_email, folder, uid, imapClients)
      break

    case 'markJunk':
      await processMarkJunk(data, account_email, folder, uid, imapClients)
      break

    case 'sendEmail':
      await processSendEmail(data, account_email)
      break

    default:
      throw new Error(`Unknown sync operation: ${opType}`)
  }
}

async function processSetFlags(data, accountEmail, folder, uid, imapClients) {
  const client = imapClients.get(accountEmail)
  if (!client) throw new Error(`No IMAP client for ${accountEmail}`)

  const { flag, add } = data
  await client.setFlag(folder, uid, flag, add)
}

async function processMoveMessage(data, accountEmail, folder, uid, imapClients) {
  const client = imapClients.get(accountEmail)
  if (!client) throw new Error(`No IMAP client for ${accountEmail}`)

  const { destination } = data
  await client.moveMessage(folder, uid, destination)
}

async function processDeleteMessage(data, accountEmail, folder, uid, imapClients) {
  const client = imapClients.get(accountEmail)
  if (!client) throw new Error(`No IMAP client for ${accountEmail}`)

  const { permanent } = data
  await client.deleteMessage(folder, uid, permanent)
}

async function processMarkJunk(data, accountEmail, folder, uid, imapClients) {
  const client = imapClients.get(accountEmail)
  if (!client) throw new Error(`No IMAP client for ${accountEmail}`)

  const { isJunk } = data
  await client.markJunk(folder, uid, isJunk)
}

async function processSendEmail(data, accountEmail) {
  const { email, password, mailOptions } = data
  await sendEmail(email, password, mailOptions)
}