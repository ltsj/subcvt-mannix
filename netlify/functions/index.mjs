import { spawn } from 'child_process'
import { brotliCompressSync, gzipSync } from 'zlib'
import axios from 'axios'
import YAML from 'yaml'

const SUBCONVERTERS = [
  '127.0.0.1:25500',
]

const urlDecode = x => {
  x = x?.replaceAll('+', ' ') ?? ''
  try {
    x = decodeURIComponent(x)
  } catch (ignored) {}
  return x
}

const GITHUB_REPOS_API = axios.create({
  baseURL: 'https://api.github.com/repos/',
  headers: { 'authorization': 'Bearer ' + process.env.GITHUB_REPOS_API_KEY }
})

async function getGithubRawURL(path) {
  if (!Array.isArray(path)) path = path.split('/').filter(x => x)
  if (path.length < 4) throw new SCError('raw 路径错误')
  const repo = path[0] + '/' + path[1]
  const [sha, i] = await GITHUB_REPOS_API(`${repo}/git/refs/heads/${path[2]}`)
    .catch(e => {
      if (e.response?.status === 404)
        return GITHUB_REPOS_API(`${repo}/git/refs/tags/${path[2]}`)
      throw e
    })
    .then(({ data }) => {
      if (!Array.isArray(data)) return [data.object.sha, 3]
      for (const item of data) {
        const ref_parts = item.ref.split('/')
        if (ref_parts.length >= path.length) continue
        for (let i = 3;; ++i) {
          if (i >= ref_parts.length) return [item.object.sha, i]
          if (ref_parts[i] !== path[i]) break
        }
      }
      return [path[2], 3]
    })
    .catch(e => {
      if (e.response?.status === 404)
        return [path[2], 3]
      throw e
    })
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path.slice(i).join('/')}`
}

const DEFAULT_SEARCH_PARAMS = [
  ['target', () => 'clash'],
  ['udp', () => 'true'],
  ['scv', () => 'true'],
  ['config', () => getGithubRawURL('zsokami/ACL4SSR/main/ACL4SSR_Online_Full_Mannix.ini')],
  ['url', () => getGithubRawURL('zsokami/sub/main/trials_providers/All.yaml')]
]

const HEADER_KEYS = new Set(['content-type', 'content-disposition', 'subscription-userinfo', 'profile-update-interval'])

class SCError extends Error {}

Object.getPrototypeOf(YAML.YAMLMap).maxFlowStringSingleLineLength = Infinity

function cleanClash(clash, options = {}) {
  const y = YAML.parseDocument(clash, { version: '1.1' })
  console.time('in cleanClash')
  const re_type = options['type'] && new RegExp(`^(?:${options['type']})$`)
  const re_type_not = options['type!'] && new RegExp(`^(?:${options['type!']})$`)
  const removed = new Set()
  const ps = y.get('proxies')?.items || []
  let i = 0
  for (const p of ps) {
    const uuid = p.get('uuid')
    const type = p.get('type')
    if (
      (uuid === undefined || /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(uuid))
      && (!re_type || re_type.test(type))
      && (!re_type_not || !re_type_not.test(type))
    ) {
      const grpc_service_name = p.getIn(['grpc-opts', 'grpc-service-name'], true)
      if (grpc_service_name !== undefined) {
        try {
          grpc_service_name.value = urlDecode(grpc_service_name.value)
          if (grpc_service_name.type === 'PLAIN' && grpc_service_name.value.includes('?')) {
            grpc_service_name.type = 'QUOTE_DOUBLE'
          }
        } catch (ignored) {}
      }
      ps[i++] = p
    } else {
      removed.add(p.get('name'))
    }
  }
  ps.splice(i)
  const gs = y.get('proxy-groups')?.items
  if (gs) {
    const name_g_pairs = gs.map(g => [g.get('name'), g])
    const name_to_g = Object.fromEntries(name_g_pairs)
    const names = name_g_pairs.map(([name]) => name)
    const vis = {}
    ;(function dfs (names) {
      let i = 0
      for (const name of names) {
        const name_v = name.value ?? name
        if (removed.has(name_v)) continue
        const g = name_to_g[name_v]
        if (g !== undefined) {
          if (!(name_v in vis)) {
            vis[name_v] = -1
            if (!(vis[name_v] = dfs(g.get('proxies').items))) {
              removed.add(name_v)
              continue
            }
          } else if (vis[name_v] === -1) {
            throw new SCError(`循环引用 ${name_v}`)
          }
        }
        names[i++] = name
      }
      names.splice(i)
      return i > 1 || (i === 1 && names[0].value !== 'DIRECT')
    })(names)
    if (names.length < gs.length) {
      names.forEach((name, i) => (gs[i] = name_to_g[name]))
      gs.splice(names.length)
    }
  }
  if (removed.size) {
    const rules = y.get('rules')?.items || []
    let i = 0
    for (const rule of rules) {
      if (!removed.has(rule.value.split(',')[2])) {
        rules[i++] = rule
      }
    }
    rules.splice(i)
  }
  console.timeEnd('in cleanClash')
  return y.toString({
    lineWidth: 0,
    indentSeq: false,
    flowCollectionPadding: false
  })
}

function wrap(handler) {
  return async (req, context) => {
    const { data = '', ...init } = await handler(req, context)
    const [ce, fn] = req.headers.get('accept-encoding')?.match(/\bbr\b(?!\s*;\s*q=0(?:\.0*)?(?:,|$))/i)
      ? ['br', brotliCompressSync] : ['gzip', gzipSync]
    init.headers = init.headers ? Object.fromEntries(Object.entries(init.headers).filter(h => HEADER_KEYS.has(h[0]))) : {}
    init.headers['content-encoding'] = ce
    return new Response(fn(data), init)
  }
}

export default wrap(async (req, context) => {
  try {
    const url = new URL(req.url)
    let suburlmatch = url.search.match(/[?&][^&=]*(:|%3A)/i)
    if (suburlmatch) {
      const sub = url.search.substring(suburlmatch.index + 1)
      url.search = url.search.substring(0, suburlmatch.index)
      url.searchParams.set('url', suburlmatch[1] === ':' ? sub : urlDecode(sub))
    }
    const pathstr = url.pathname
    const path = pathstr.split('/').filter(x => x)
    if (path[0]?.includes('.') && !path[0].includes('%')) {
      url.host = path.shift()
    } else {
      url.host = SUBCONVERTERS[(Math.random() * SUBCONVERTERS.length) | 0]
    }
    if (!path.length) {
      url.pathname = 'sub'
    } else if (path[0] === 'r') {
      url.pathname = 'sub'
      path.shift()
      url.searchParams.set('url', await getGithubRawURL(path))
    } else if (suburlmatch = pathstr.match(/[^/]*(?::|%3A)(?:\/|%2F).*/i)) {
      url.pathname = 'sub'
      url.searchParams.set('url', urlDecode(suburlmatch[0]))
    } else {
      url.pathname = path.join('/')
    }
    const options = {}
    if (url.pathname === '/sub') {
      for (const [k, v] of DEFAULT_SEARCH_PARAMS) {
        if (!url.searchParams.get(k)) url.searchParams.set(k, await v())
      }
      if (url.searchParams.get('target') === 'clash') {
        options['type'] = url.searchParams.get('type')
        options['type!'] = url.searchParams.get('type!')
        url.searchParams.delete('type')
        url.searchParams.delete('type!')
      }
      const suburl = url.searchParams.get('url')
      if (suburl && !url.searchParams.get('filename') && !req.headers.get('accept')?.includes('text/html')) {
        let m
        if (m = suburl.match(/^https?:\/\/raw.githubusercontent.com\/+([^/|]+)(?:\/+[^/|]+){2,}\/+([^/|]+)$/)) {
          url.searchParams.set('filename', m[1] === m[2] ? m[1] : m[1] + ' - ' + urlDecode(m[2]))
        } else if (m = suburl.match(/^(https?:\/\/raw.githubusercontent.com\/+([^/|]+))(?:\/+[^/|]+){3,}(?:\|+\1(?:\/+[^/|]+){3,})*$/)) {
          url.searchParams.set('filename', m[2])
        }
      }
    }
    url.search = url.search.replace(/%2F/gi, '/')
    console.time('subconverter')
    let subconverter_process
    if (url.host === '127.0.0.1:25500') {
      url.protocol = 'http:'
      subconverter_process = spawn('subconverter/subconverter')
      await new Promise(resolve => {
        subconverter_process.stderr.on('data', function listener(data) {
          if (data.includes('Startup completed')) {
            resolve()
            subconverter_process.stderr.off('data', listener)
          }
        })
      })
    }
    let { status, headers, data } = await axios.get(url.href, {
      headers: { 'user-agent': req.headers.get('user-agent') },
      responseType: 'text'
    })
    if (url.host === '127.0.0.1:25500') {
      subconverter_process.kill()
    }
    console.timeEnd('subconverter')
    if (
      url.pathname === '/sub' &&
      url.searchParams.get('target') === 'clash'
    ) {
      console.time('cleanClash')
      data = cleanClash(data, options)
      console.timeEnd('cleanClash')
    }
    return { data, status, headers }
  } catch (e) {
    const response = e?.response
    if (response) {
      let { status, headers, data } = response
      if (typeof data !== 'string') data = JSON.stringify(data)
      return { data, status, headers }
    }
    return { data: String(e), status: e instanceof SCError ? 400 : 500, headers: { 'content-type': 'text/plain;charset=utf-8' } }
  }
})

export const config = {
  path: '/*'
}