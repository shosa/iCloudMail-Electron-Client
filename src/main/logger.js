const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const CYAN   = '\x1b[36m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const BLUE   = '\x1b[34m'
const MAGENTA= '\x1b[35m'

function ts() {
  return `${DIM}${new Date().toTimeString().slice(0, 8)}${RESET}`
}

export function logSync(msg)    { console.log(`${ts()} ${CYAN}${BOLD}[SYNC]${RESET}  ${msg}`) }
export function logMail(msg)    { console.log(`${ts()} ${GREEN}${BOLD}[MAIL]${RESET}  ${msg}`) }
export function logMove(msg)    { console.log(`${ts()} ${YELLOW}${BOLD}[MOVE]${RESET}  ${msg}`) }
export function logDelete(msg)  { console.log(`${ts()} ${RED}${BOLD}[DEL]${RESET}   ${msg}`) }
export function logContact(msg) { console.log(`${ts()} ${BLUE}${BOLD}[CARD]${RESET}  ${msg}`) }
export function logCal(msg)     { console.log(`${ts()} ${MAGENTA}${BOLD}[CAL]${RESET}   ${msg}`) }
export function logInfo(msg)    { console.log(`${ts()} ${DIM}[INFO]${RESET}  ${msg}`) }
export function logWarn(msg)    { console.warn(`${ts()} ${YELLOW}[WARN]${RESET}  ${msg}`) }
export function logErr(msg)     { console.error(`${ts()} ${RED}[ERR]${RESET}   ${msg}`) }
