import { useAppState } from '../context/AppContext'
import enUS from '../locales/en-US.json'
import itIT from '../locales/it-IT.json'
import frFR from '../locales/fr-FR.json'
import deDE from '../locales/de-DE.json'
import jaJP from '../locales/ja-JP.json'
import esES from '../locales/es-ES.json'
import ruRU from '../locales/ru-RU.json'
import zhCN from '../locales/zh-CN.json'
import ptBR from '../locales/pt-BR.json'
import koKR from '../locales/ko-KR.json'
import trTR from '../locales/tr-TR.json'
import nlNL from '../locales/nl-NL.json'

export const locales = {
  'en-US': enUS,
  'it-IT': itIT,
  'fr-FR': frFR,
  'de-DE': deDE,
  'ja-JP': jaJP,
  'es-ES': esES,
  'ru-RU': ruRU,
  'zh-CN': zhCN,
  'pt-BR': ptBR,
  'ko-KR': koKR,
  'tr-TR': trTR,
  'nl-NL': nlNL,
}

// Backward-compat aliases for settings stored before the ISO rename
const LANG_ALIASES = {
  en: 'en-US', it: 'it-IT', fr: 'fr-FR', de: 'de-DE',
  jp: 'ja-JP', es: 'es-ES', ru: 'ru-RU', cn: 'zh-CN',
}

export function useTranslation() {
  let state
  try {
    state = useAppState()
  } catch {
    return (key) => enUS[key] || key
  }
  const raw = state?.settings?.language || 'en-US'
  const lang = LANG_ALIASES[raw] || raw
  const locale = locales[lang] || locales['en-US']

  return function t(key, ...args) {
    let str = locale[key] ?? locales['en-US'][key] ?? key
    args.forEach((arg, i) => { str = str.replace(`{${i}}`, String(arg)) })
    return str
  }
}
