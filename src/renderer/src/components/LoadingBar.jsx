import React from 'react'
import { useAppState } from '../context/AppContext'

export default function LoadingBar() {
  const { loading } = useAppState()
  const { active, label } = loading

  return (
    <div className={`loading-bar${active ? ' loading-bar--active' : ''}`}>
      <div className="loading-bar__track">
        {active && <div className="loading-bar__fill" />}
      </div>
      <div className={`loading-bar__label${label ? ' loading-bar__label--visible' : ''}`}>
        {label}
      </div>
    </div>
  )
}
