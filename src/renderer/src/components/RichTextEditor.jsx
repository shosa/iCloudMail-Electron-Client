import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

const DEFAULT_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    ['blockquote', 'link', 'image'],
    ['clean']
  ],
  clipboard: {
    matchVisual: false
  }
}

const RichTextEditor = forwardRef(function RichTextEditor(
  { value = '', onChange, placeholder, modules = DEFAULT_MODULES, className = '' },
  ref
) {
  const rootRef = useRef(null)
  const editorRef = useRef(null)
  const valueRef = useRef(value || '')
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const root = rootRef.current
    if (!root || editorRef.current) return

    root.innerHTML = ''
    const editorHost = document.createElement('div')
    root.appendChild(editorHost)

    const quill = new Quill(editorHost, {
      theme: 'snow',
      placeholder,
      modules
    })

    if (valueRef.current) {
      quill.clipboard.dangerouslyPasteHTML(valueRef.current)
    }

    quill.on('text-change', (_delta, _oldDelta, source) => {
      if (source !== 'user') return
      const html = quill.root.innerHTML
      valueRef.current = html
      onChangeRef.current?.(html, quill.getText())
    })

    editorRef.current = quill

    return () => {
      editorRef.current = null
      root.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    const quill = editorRef.current
    const nextValue = value || ''
    if (!quill || nextValue === valueRef.current) return

    const selection = quill.getSelection()
    valueRef.current = nextValue
    quill.clipboard.dangerouslyPasteHTML(nextValue)
    if (selection) {
      const length = quill.getLength()
      quill.setSelection(Math.min(selection.index, length - 1), selection.length, 'silent')
    }
  }, [value])

  useImperativeHandle(ref, () => ({
    getHTML: () => editorRef.current?.root.innerHTML || '',
    getText: () => editorRef.current?.getText() || '',
    getSelectedText: () => {
      const quill = editorRef.current
      const selection = quill?.getSelection()
      if (!quill || !selection || selection.length === 0) return ''
      return quill.getText(selection.index, selection.length)
    },
    focus: () => editorRef.current?.focus(),
    selectAll: () => {
      const quill = editorRef.current
      if (!quill) return
      quill.focus()
      quill.setSelection(0, Math.max(0, quill.getLength() - 1), 'user')
    },
    cutSelection: async () => {
      const quill = editorRef.current
      const selection = quill?.getSelection()
      if (!quill || !selection || selection.length === 0) return false
      const text = quill.getText(selection.index, selection.length)
      await navigator.clipboard.writeText(text)
      quill.deleteText(selection.index, selection.length, 'user')
      quill.setSelection(selection.index, 0, 'silent')
      return true
    },
    copySelection: async () => {
      const quill = editorRef.current
      const selection = quill?.getSelection()
      if (!quill || !selection || selection.length === 0) return false
      await navigator.clipboard.writeText(quill.getText(selection.index, selection.length))
      return true
    },
    pasteText: async () => {
      const quill = editorRef.current
      if (!quill) return false
      const text = await navigator.clipboard.readText()
      if (!text) return false
      const selection = quill.getSelection(true) || { index: quill.getLength() - 1, length: 0 }
      if (selection.length) quill.deleteText(selection.index, selection.length, 'user')
      quill.insertText(selection.index, text, 'user')
      quill.setSelection(selection.index + text.length, 0, 'silent')
      return true
    },
    clearSelectionFormatting: () => {
      const quill = editorRef.current
      const selection = quill?.getSelection()
      if (!quill || !selection || selection.length === 0) return false
      quill.removeFormat(selection.index, selection.length, 'user')
      return true
    }
  }), [])

  return (
    <div ref={rootRef} className={`rich-text-editor ${className}`.trim()} />
  )
})

export default RichTextEditor
