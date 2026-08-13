/**
 * Which view a URL asks for.
 *
 * Kept out of main.ts so the decision is directly testable rather than being
 * re-implemented by the tests.
 */

import { fromSearchParams, type DiagramParams } from '../core/url'

export type Route =
  | { view: 'viewer'; params: DiagramParams }
  | { view: 'editor'; params: DiagramParams | null }

/** `search` is a query string, with or without the leading `?`. */
export function routeFor(search: string): Route {
  const params = fromSearchParams(new URLSearchParams(search))
  // A recognised `format` shows the bare image; anything else is the editor.
  return params?.format ? { view: 'viewer', params } : { view: 'editor', params }
}
