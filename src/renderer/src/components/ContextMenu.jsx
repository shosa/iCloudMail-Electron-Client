import React, { useEffect, useRef, useState } from 'react'
import {
  IconReply, IconReplyAll, IconForward, IconMarkRead, IconStar,
  IconMove, IconNoSymbol, IconTrash, IconFolder, IconClose
} from './Icons'
import { useTranslation } from '../i18n/index'

function Item({ icon, label, onClick, danger, disabled }) {
  return (
    <div
      className={`context-menu__item${danger ? ' context-menu__item--danger' : ''}${disabled ? ' context-menu__item--disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      role="menuitem"
    >
      {icon && <span className="context-menu__icon">{icon}</span>}
      <span>{label}</span>
    </div>
  )
}

const FOLDER_LABEL_KEY = {
  '\\Inbox':   'folder.inbox',
  '\\Sent':    'folder.sent',
  '\\Drafts':  'folder.drafts',
  '\\Trash':   'folder.trash',
  '\\Junk':    'folder.junk',
  '\\Archive': 'folder.archive'
}

export default function ContextMenu({ x, y, messages = [], folders = [], onClose, onAction }) {
  const t = useTranslation()
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x, y })
  const [showMove, setShowMove] = useState(false)

  const isMulti = messages.length > 1
  const msg = messages[0]

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({
      x: x + rect.width > vw - 8 ? Math.max(8, vw - rect.width - 8) : x,
      y: y + rect.height > vh - 8 ? Math.max(8, vh - rect.height - 8) : y
    })
  }, [x, y])

  useEffect(() => {
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!msg) return null

  // For mixed-state multi-selection checks
  const allRead    = messages.every(m => m.flags?.includes('\\Seen'))
  const allUnread  = messages.every(m => !m.flags?.includes('\\Seen'))
  const allStarred = messages.every(m => m.flags?.includes('\\Flagged'))
  const moveFolders = folders.filter(f => f.path !== msg.folder)

  function act(type, data) {
    onAction(type, data)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {isMulti && (
        <>
          <div className="context-menu__header">
            {t('multiselect.count', messages.length)}
          </div>
          <div className="context-menu__separator" />
        </>
      )}

      {!isMulti && (
        <>
          <Item icon={<IconReply size={15} />}    label={t('action.reply')}    onClick={() => act('reply')} />
          <Item icon={<IconReplyAll size={15} />} label={t('action.replyAll')} onClick={() => act('replyAll')} />
          <Item icon={<IconForward size={15} />}  label={t('action.forward')}  onClick={() => act('forward')} />
          <div className="context-menu__separator" />
        </>
      )}

      {!allRead && (
        <Item
          icon={<IconMarkRead size={15} />}
          label={t('action.markRead')}
          onClick={() => act('markRead')}
        />
      )}
      {!allUnread && (
        <Item
          icon={<IconMarkRead size={15} />}
          label={t('action.markUnread')}
          onClick={() => act('markUnread')}
        />
      )}
      {!allStarred && (
        <Item icon={<IconStar size={15} />} label={t('action.star')}   onClick={() => act('star')} />
      )}
      {allStarred && (
        <Item icon={<IconStar size={15} />} label={t('action.unstar')} onClick={() => act('unstar')} />
      )}

      {moveFolders.length > 0 && (
        <>
          <div className="context-menu__separator" />
          <div
            className="context-menu__item context-menu__item--submenu"
            onMouseEnter={() => setShowMove(true)}
            onMouseLeave={() => setShowMove(false)}
          >
            <span className="context-menu__icon"><IconMove size={15} /></span>
            <span>{t('action.moveTo')}</span>
            <span className="context-menu__chevron">›</span>
            {showMove && (
              <div className="context-menu context-menu--sub">
                {moveFolders.map(f => (
                  <Item
                    key={f.path}
                    icon={<IconFolder size={15} />}
                    label={f.special_use && FOLDER_LABEL_KEY[f.special_use] ? t(FOLDER_LABEL_KEY[f.special_use]) : (f.name || f.path.split('/').pop())}
                    onClick={() => act('move', f.path)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="context-menu__separator" />
      <Item icon={<IconNoSymbol size={15} />} label={t('action.markJunk')} onClick={() => act('junk')} />
      <Item icon={<IconTrash size={15} />}    label={t('action.delete')}   onClick={() => act('delete')} danger />
    </div>
  )
}
