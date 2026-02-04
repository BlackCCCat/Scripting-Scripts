
import App from './App'
import { Navigation } from 'scripting'

// Present when script runs (normal launch)
;(async () => {
  await Navigation.present({ element: <App /> })
})()
