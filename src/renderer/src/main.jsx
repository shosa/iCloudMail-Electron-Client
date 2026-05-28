import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './context/AppContext'
import MessageViewerApp from './components/MessageViewerApp'
import ComposeViewerApp from './components/ComposeViewerApp'
import './styles/variables.css'
import './styles/global.css'
import './styles/components.css'

const params = new URLSearchParams(window.location.search)
const isViewer = params.get('viewer') === '1'
const isCompose = params.get('compose') === '1'
const viewerId = params.get('vid')
const composeId = params.get('cid')

if (isViewer && viewerId) {
  window.api.store.getViewerData(viewerId).then(result => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <MessageViewerApp message={result?.data || null} />
      </React.StrictMode>
    )
  })
} else if (isCompose && composeId) {
  window.api.store.getViewerData(composeId).then(result => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <ComposeViewerApp composeData={result?.data || null} />
      </React.StrictMode>
    )
  })
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>
  )
}
