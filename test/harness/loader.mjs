/**
 * Makes `src/game/machine.ts` loadable by `node --test`.
 *
 * Two things stand in the way, and neither is worth changing the scene for:
 *
 *  1. Scene code imports `@dcl/sdk/*`, which needs a renderer to mean anything.
 *     Those specifiers are redirected to the fakes in this directory.
 *  2. Scene code imports without file extensions, which Node's ESM resolver
 *     does not do. A missing path gets `.ts` appended.
 *
 * It also carries a `?w=` tag from a module to everything it imports, so
 * `import('…/machine.ts?w=2')` produces a *second, independent* copy of the
 * whole `src` graph. That is what lets one test drive several clients: each
 * gets its own module-level host state, exactly as separate machines would,
 * while the fake SDK stays a singleton and gives them one shared world.
 */
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const HERE = new URL('./', import.meta.url)

const FAKES = {
  '@dcl/sdk/ecs': 'sdk-ecs.ts',
  '@dcl/sdk/network': 'sdk-network.ts',
  '@dcl/sdk/players': 'sdk-players.ts'
}

const tagOf = (href) => (href ? new URL(href).searchParams.get('w') : null)

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fake = FAKES[specifier]
    if (fake) return { url: new URL(fake, HERE).href, shortCircuit: true }

    if (specifier.startsWith('@dcl/')) {
      throw new Error(
        `The test harness has no stand-in for "${specifier}". Add one in test/harness/ ` +
          `and register it in loader.mjs, or keep it out of the modules under test.`
      )
    }

    if (specifier.startsWith('.') && context.parentURL) {
      const raw = new URL(specifier, context.parentURL)
      const tag = tagOf(raw.href) ?? tagOf(context.parentURL)
      let url = new URL(raw.href.split('?')[0])
      if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(new URL(`${url.href}.ts`)))) {
        url = new URL(`${url.href}.ts`)
      }
      if (tag) url.searchParams.set('w', tag)
      return { url: url.href, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  }
})
