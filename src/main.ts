import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import Viewer from './Viewer.svelte'
import { routeFor } from './lib/route'
import { MistyStates } from './core/api'

// Expose the API for scripts on the page, e.g. window.MistyStates.svg('0|1').
declare global {
  interface Window {
    MistyStates: typeof MistyStates
  }
}
window.MistyStates = MistyStates

const target = document.getElementById('app')!
const route = routeFor(location.search)

export default route.view === 'viewer'
  ? mount(Viewer, { target, props: { params: route.params } })
  : mount(App, { target })
