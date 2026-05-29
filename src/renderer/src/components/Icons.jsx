import React from 'react'

function SvgIcon({ d, size = 18, className = '', strokeWidth = 1.75 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {(Array.isArray(d) ? d : [d]).map((path, i) => <path key={i} d={path} />)}
    </svg>
  )
}

export const IconInbox     = p => <SvgIcon {...p} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
export const IconSent      = p => <SvgIcon {...p} d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
export const IconDrafts    = p => <SvgIcon {...p} d={["M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5", "M17.586 3.586a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"]} />
export const IconTrash     = p => <SvgIcon {...p} d={["M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3", "M4 7h16"]} />
export const IconJunk      = p => <SvgIcon {...p} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
export const IconArchive   = p => <SvgIcon {...p} d={["M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8", "M10 12h4"]} />
export const IconFolder    = p => <SvgIcon {...p} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
export const IconCompose   = p => <SvgIcon {...p} d={["M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5", "M17.586 3.586a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"]} />
export const IconSettings  = p => <SvgIcon {...p} d={["M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", "M15 12a3 3 0 11-6 0 3 3 0 016 0z"]} />
export const IconSearch    = p => <SvgIcon {...p} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
export const IconReply     = p => <SvgIcon {...p} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
export const IconReplyAll  = p => <SvgIcon {...p} d={["M1 10h12a8 8 0 018 8v2", "M5 10l5 5m-5-5l5-5", "M1 10l4 4m-4-4l4-4"]} />
export const IconForward   = p => <SvgIcon {...p} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6-6m6 6l-6 6" />
export const IconStar      = p => <SvgIcon {...p} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
export const IconMarkRead  = p => <SvgIcon {...p} d={["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 9a3 3 0 100 6 3 3 0 000-6z"]} />
export const IconRefresh   = p => <SvgIcon {...p} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
export const IconSignOut   = p => <SvgIcon {...p} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
export const IconAttach    = p => <SvgIcon {...p} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
export const IconClose     = p => <SvgIcon {...p} d="M6 18L18 6M6 6l12 12" />
export const IconLanguage  = p => <SvgIcon {...p} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
export const IconMove      = p => <SvgIcon {...p} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
export const IconNoSymbol  = p => <SvgIcon {...p} d="M18.364 18.364A9 9 0 105.636 5.636a9 9 0 0012.728 12.728zM9.75 9.75l4.5 4.5" />
export const IconOpenWindow = p => <SvgIcon {...p} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
export const IconEnvelope  = p => <SvgIcon {...p} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
export const IconClearCache = p => <SvgIcon {...p} d={["M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6", "M4 7h16M10 3h4"]} />
export const IconSend       = p => <SvgIcon {...p} d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
export const IconDownload   = p => <SvgIcon {...p} d={["M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1", "M12 4v12m-4-4l4 4 4-4"]} />
export const IconFileImage  = p => <SvgIcon {...p} d={["M4 16l4.586-4.586a2 2 0 012.828 0L16 16", "M14 14l1.586-1.586a2 2 0 012.828 0L20 14", "M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", "M10 10m-1 0a1 1 0 102 0 1 1 0 10-2 0"]} />
export const IconFileDoc    = p => <SvgIcon {...p} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
export const IconBold       = p => <SvgIcon {...p} d={["M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z", "M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"]} />
export const IconItalic     = p => <SvgIcon {...p} d={["M10 4h4", "M6 20h4", "M14 4l-4 16"]} />
export const IconUnderlineF = p => <SvgIcon {...p} d={["M7 5v8a5 5 0 0010 0V5", "M5 19h14"]} />
export const IconStrike     = p => <SvgIcon {...p} d={["M5 12h14", "M16 6H9a4 4 0 000 8h5a4 4 0 010 8H7"]} />
export const IconListBullet = p => <SvgIcon {...p} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
export const IconListOrdered= p => <SvgIcon {...p} d={["M10 6h11", "M10 12h11", "M10 18h11", "M4 6h1v4", "M4 10H3", "M3 17h2a1 1 0 000-2H4a1 1 0 010-2h2"]} />
export const IconAlignLeft  = p => <SvgIcon {...p} d={["M21 6H3", "M15 12H3", "M17 18H3"]} />
export const IconAlignCenter= p => <SvgIcon {...p} d={["M21 6H3", "M17 12H7", "M19 18H5"]} />
export const IconAlignRight = p => <SvgIcon {...p} d={["M21 6H3", "M21 12H9", "M21 18H7"]} />
export const IconQuote      = p => <SvgIcon {...p} d={["M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z", "M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"]} />
export const IconContacts   = p => <SvgIcon {...p} d={["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2", "M9 11a4 4 0 100-8 4 4 0 000 8z", "M23 21v-2a4 4 0 00-3-3.87", "M16 3.13a4 4 0 010 7.75"]} />
export const IconCalendar   = p => <SvgIcon {...p} d={["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"]} />
export const IconMail       = p => <SvgIcon {...p} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
export const IconPhone      = p => <SvgIcon {...p} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
export const IconChevronRight = p => <SvgIcon {...p} d="M9 18l6-6-6-6" />
export const IconSync       = p => <SvgIcon {...p} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
export const IconClock      = p => <SvgIcon {...p} d={["M12 8v4l3 3", "M21 12a9 9 0 11-18 0 9 9 0 0118 0"]} />
export const IconPin        = p => <SvgIcon {...p} d="M5.05 4.05a7 7 0 119.9 9.9L10 18l-4.95-4.95a7 7 0 010-9.9z" />
export const IconResize     = p => <SvgIcon {...p} d={["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"]} />
export const IconCheck      = p => <SvgIcon {...p} d="M5 13l4 4L19 7" />
export const IconFolderOpen = p => <SvgIcon {...p} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
export const IconLink       = p => <SvgIcon {...p} d={["M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"]} />
