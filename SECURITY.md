# Security

Planet Generator is a static page on GitHub Pages. A planet is made on the
device from its seed; there is no server of ours, no account, no cookie and
no request that carries anything about the user. That shapes everything
below: the job is to keep the page from being turned against the person
viewing it, since there is nothing behind it to steal.

## What comes in, and how it is read

| Input                                       | Read by                             | Rule                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link (`?seed=`, dials, `shot=`, `sys=`) | `app/link.ts`, `generation/seed.ts` | Parsed totally: a seed is seven characters of a fixed alphabet; every number is range-checked; a `shot` over 64 characters is refused. Anything else opens the plain planet. |
| The atlas in `localStorage`                 | `app/atlas.ts` (`parseAtlas`)       | Read as `unknown`; a picture must be a base64 JPEG under 64 kB; at most 200 entries read. Only `ui/atlas-store.ts` may touch storage (lint rule).                            |
| Build environment                           | `app/config.ts`                     | `developer` comes from Vite's `DEV` alone; no variable can turn the recorder on in a build (tested).                                                                         |

Nothing is written into the page as HTML: there is no `innerHTML` in `src/`.
Names and text go in by `textContent`.

## What the page may do

`index.html` carries a Content-Security-Policy: script, workers, styles,
images and media from the site itself (plus `data:` and `blob:` for the
atlas pictures and the clips), no plugins, no `<base>`, no form targets.
`connect-src` is `'self'` in a build; the dev server's `ws:` is stripped by
the `planet-strict-csp` plugin in `vite.config.ts`, which fails the build if
it cannot find it. `<meta name="referrer" content="no-referrer">` keeps a
seed link from leaking to any page reached from it.

## Supply chain

One runtime dependency, three.js. CI runs `pnpm audit --prod`; Dependabot
proposes npm and Actions updates weekly; every action is pinned to a commit;
checkout keeps no token; CI refuses a lockfile entry that is not a registry package with a sha512 integrity hash, and the pre-push hook runs the same audit. The deploy needs `pages: write` and `id-token:
write` and nothing else.

## On GitHub

CodeQL (`security-extended`) runs on every push, every PR and weekly; its
one finding, the build worker's `onmessage` without an origin check, is
dismissed as a false positive for the reason under "Deliberately not done".
Secret scanning with push protection, Dependabot alerts and security
updates, and private vulnerability reporting are on. `main` requires the
CI `Verify` check, refuses force-pushes and deletion; the owner can still
push directly (admins are not enforced), so the pre-push hook is the gate
there.

## Sharing an origin

Every Pages project of an account is served from one `github.io` origin and
shares its storage. The service worker's caches are `planet-generator-*` and
it deletes only those (and its own pre-prefix `planet-<12 hex>` names); the
atlas key is `planet-generator.atlas.v1`, and whatever is under it is parsed
as hostile. The worker's scope is the project's base path.

## Deliberately not done, and why

- **Permissions-Policy, HSTS, `X-Frame-Options`.** They are headers, and
  GitHub Pages sends none of ours; a meta tag cannot set them. Pages serves
  HTTPS only. Framing the app is harmless: it holds no session to click-jack.
- **`style-src 'unsafe-inline'`.** The page's styles are inline and the code
  sets `style` properties. A style injection would need an HTML injection
  first, and there is no path that writes HTML.
- **Checking messages from the build workers.** A dedicated worker can be
  messaged only by the page that made it.
- **The service worker's cache.** It caches its own precache list at install
  and never writes what it fetches afterwards, so a response it sees later
  cannot be kept and served offline.
- **Subresource integrity.** Every script is same-origin and content-hashed;
  SRI protects against a CDN, and there is none.

## Reporting

Open a private security advisory on the GitHub repository.
