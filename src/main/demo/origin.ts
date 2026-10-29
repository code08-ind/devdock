/** Base host used by all demo fixtures (never resolvable: `.invalid`). */
export const DEMO_ORIGIN = 'https://demo.devdock.invalid'

/**
 * Demo GitHub (Enterprise Server shape) and GitLab sites (P7). Their own hosts, because their
 * links have no room for a path prefix (`/<owner>/<repo>/pull/<n>`).
 */
export const DEMO_GITHUB = 'https://github.demo.devdock.invalid'
export const DEMO_GITLAB = 'https://gitlab.demo.devdock.invalid'
export const DEMO_HOSTS = [new URL(DEMO_GITHUB).hostname, new URL(DEMO_GITLAB).hostname]
