/**
 * Hyperspan
 * Only export html/client libs by default just incase this gets in a JS bundle
 * Server package must be imported with 'hypserspan/server'
 */
export {
  _typeOf,
  clientComponent,
  compressHTMLString,
  html,
  HSTemplate,
  renderToStream,
  renderToString,
} from './html';
export { IS_CLIENT } from './client';
