import React from 'react'
import ReactDOM from 'react-dom/client'
import { DraftLibrary } from './components/DraftLibrary'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DraftLibrary />
  </React.StrictMode>
)
