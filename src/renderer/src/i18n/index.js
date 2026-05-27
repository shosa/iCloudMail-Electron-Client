import { useAppState } from '../context/AppContext'
import en from '../locales/en.json'
import it from '../locales/it.json'
import fr from '../locales/fr.json'
import de from '../locales/de.json'
import jp from '../locales/jp.json'
import es from  '../locales/es.json'
import ru from  '../locales/ru.json'
import cn from '../locales/cn.json'

const locales = { en, it, fr, de , jp, es , ru , cn}

export function useTranslation() {
  let state
  try {
    state = useAppState()
  } catch {
    return (key) => en[key] || key
  }
  const lang = state?.settings?.language || 'en'
  const locale = locales[lang] || locales.en

  return function t(key, ...args) {
    let str = locale[key] ?? locales.en[key] ?? key
    args.forEach((arg, i) => { str = str.replace(`{${i}}`, String(arg)) })
    return str
  }
}
