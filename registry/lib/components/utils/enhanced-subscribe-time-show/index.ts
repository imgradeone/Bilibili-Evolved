import { defineComponentMetadata } from '@/components/define'
import { useScopedConsole } from '@/core/utils/log'
import { bilibiliApi, getJsonWithCredentials } from '@/core/ajax'
import { select } from '@/core/spin-query'
import { allMutations } from '@/core/observer'
import { getUserInfo } from '@/core/user-info'

const displayName = '关注时间显示·增强'
const console = useScopedConsole(displayName)

const SELECTORS = {
  profileFollowContainer: '.space-head-follow.b-follow',
  profileTextClass: 'subscribe-time-text',
  relationCardAnchor: '.relation-card-info__uname',
  relationCardContainer: '.relation-card-info',
  relationCardTimeClass: 'relation-card-info__time',
  relationCardSign: '.relation-card-info__sign',
}

type FollowTimeInfo = {
  mtime: number
  label: string
}

type RelationData = {
  attribute?: number
  mtime?: number
}

const midMap: Record<number, FollowTimeInfo> = {}

const insertFollowTimeToCard = (mid: number, dateStr: string, label: string) => {
  const anchor = dq(`${SELECTORS.relationCardAnchor}[href*="/${mid}"]`)
  const card = anchor?.closest(SELECTORS.relationCardContainer)
  if (!card || card.querySelector(`.${SELECTORS.relationCardTimeClass}`)) {
    return
  }

  const div = document.createElement('div')
  div.className = SELECTORS.relationCardTimeClass
  div.textContent = `${label}：${dateStr}`
  div.dataset.mid = mid.toString()

  const sign = card.querySelector(SELECTORS.relationCardSign)
  if (sign?.parentNode) {
    sign.parentNode.insertBefore(div, sign.nextSibling)
  }
}

const updateCards = (() => {
  let scheduled = false
  return () => {
    if (scheduled) {
      return
    }
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      dqa(SELECTORS.relationCardAnchor).forEach(el => {
        const match = (el as HTMLAnchorElement).href.match(/\/(\d+)/)
        if (!match) {
          return
        }
        const mid = Number(match[1])
        if (Number.isNaN(mid)) {
          return
        }
        const data = midMap[mid]
        if (data) {
          const dateStr = new Date(data.mtime * 1000).toLocaleString()
          insertFollowTimeToCard(mid, dateStr, data.label)
        }
      })
    })
  }
})()

const insertSubscribeTime = (followTimeStr: string, label: string, key: string) => {
  const container = dq(SELECTORS.profileFollowContainer)
  if (!container) {
    return
  }

  if (container.querySelector(`.${SELECTORS.profileTextClass}[data-time-key="${key}"]`)) {
    return
  }

  if (getComputedStyle(container).position === 'static') {
    ;(container as HTMLElement).style.position = 'relative'
  }

  const infoEl = document.createElement('div')
  infoEl.className = SELECTORS.profileTextClass
  infoEl.dataset.timeKey = key
  infoEl.textContent = `${label} ${followTimeStr}`
  container.appendChild(infoEl)
}

if (!(unsafeWindow as any).subscribeTimeHooked) {
  ;(unsafeWindow as any).subscribeTimeHooked = true
  const originalFetch = unsafeWindow.fetch
  unsafeWindow.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url
      const urlObj = new URL(url, location.origin)

      if (
        urlObj.hostname === 'api.bilibili.com' &&
        (urlObj.pathname.includes('/x/relation/fans') ||
          urlObj.pathname.includes('/x/relation/followings'))
      ) {
        return target
          .apply(thisArg, args)
          .then(res => {
            res
              .clone()
              .json()
              .then(json => {
                const list = json?.data?.list
                if (!Array.isArray(list)) {
                  console.warn('接口数据结构异常:', json)
                  return
                }
                list.forEach(user => {
                  if (typeof user.mid === 'number' && typeof user.mtime === 'number') {
                    const label = url.includes('/fans') ? 'Ta 关注你的时间' : '你关注 Ta 的时间'
                    midMap[user.mid] = { mtime: user.mtime, label }
                    const dateStr = new Date(user.mtime * 1000).toLocaleString()
                    insertFollowTimeToCard(user.mid, dateStr, label)
                  }
                })
              })
              .catch(err => {
                console.warn('JSON 解析失败:', err)
              })
            return res
          })
          .catch(err => {
            console.warn('fetch 请求失败:', err)
            throw err
          })
      }

      return target.apply(thisArg, args)
    },
  })
}

const parseRelation = (relData?: RelationData, isPassive = false, mainAttribute?: number) => {
  if (!relData || !relData.mtime) {
    return null
  }

  const { attribute, mtime } = relData

  // 过滤无效状态：0 表示无关注/被关注关系
  if (!attribute || attribute === 0) {
    return null
  }

  // 校验被动关系：如果你只是单向关注对方 (mainAttribute === 2)，但对方没关注你，过滤错误的 be_relation
  if (isPassive && mainAttribute === 2 && attribute !== 6) {
    return null
  }

  if (attribute === 2 || attribute === 6) {
    return {
      mtime,
      label: isPassive ? '被关注于' : '关注于',
    }
  }

  if (attribute === 128) {
    return {
      mtime,
      label: isPassive ? '被拉黑于' : '拉黑于',
    }
  }

  return null
}

const entry = async () => {
  try {
    const { addImportantStyle } = await import('@/core/style')
    const { default: style } = await import('./enhanced-subscribe-time.scss')
    addImportantStyle(style, 'enhanced-subscribe-time-style')
  } catch (e) {
    console.error('样式加载失败:', e)
  }

  allMutations(updateCards)

  const userMid = (await getUserInfo()).mid
  const match = location.href.match(/space\.bilibili\.com\/(\d+)/)
  if (!match) {
    return
  }

  const mid = Number(match[1])
  if (mid === userMid) {
    console.log('当前为本人空间，跳过关注时间显示')
    return
  }

  const info = await bilibiliApi(
    getJsonWithCredentials(`https://api.bilibili.com/x/web-interface/relation?mid=${mid}`),
  )

  const mainAttr = info?.relation?.attribute

  const activeRel = parseRelation(info?.relation, false)
  const passiveRel = parseRelation(info?.be_relation, true, mainAttr)

  const results: { key: string; data: NonNullable<typeof activeRel> }[] = []

  if (activeRel) {
    results.push({ key: 'relation', data: activeRel })
  }

  if (passiveRel) {
    const isDuplicate =
      activeRel && activeRel.label === passiveRel.label && activeRel.mtime === passiveRel.mtime

    if (!isDuplicate) {
      results.push({ key: 'be_relation', data: passiveRel })
    }
  }

  if (results.length === 0) {
    console.log('当前未找到任何关注或拉黑关系，跳过时间显示')
    return
  }

  await select(SELECTORS.profileFollowContainer)

  const container = dq(SELECTORS.profileFollowContainer)
  if (container) {
    container.querySelectorAll(`.${SELECTORS.profileTextClass}`).forEach(el => el.remove())
  }

  results.forEach(({ key, data }) => {
    insertSubscribeTime(new Date(data.mtime * 1000).toLocaleString(), data.label, key)
  })
}

export const component = defineComponentMetadata({
  name: 'enhancedSubscribeTimeShow',
  displayName: '关注时间显示·增强',
  author: {
    name: 'imgradeone (Gemini 辅助)',
    link: 'https://github.com/imgradeone',
  },
  tags: [componentsTags.utils],
  urlInclude: [
    /^https:\/\/space\.bilibili\.com\/\d+\/(relation|fans)\/(fans|follow)/,
    /https:\/\/space\.bilibili\.com\/\d+/,
  ],
  entry,
})
