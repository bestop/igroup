/**
 * 邻里拼单 - 唯一云函数 groupbuy
 * 所有数据读写均通过本函数完成（云数据库默认权限"仅创建者可读写"下也能正常工作）。
 *
 * 两种调用方式：
 *  1. 小程序端 callFunction({ action, ...params }) -> action 路由
 *  2. 定时触发器（见 config.json）-> 自动截单，event.Type === 'Timer'
 *
 * 资金原则：本函数不触碰任何资金，只做记账 + 状态协同。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ================= 订阅消息配置（可选） =================
// 在小程序后台申请订阅模板后填入模板 ID，留空则跳过发送（不影响主流程）。
// 发送字段为 thing1/thing2，请按你申请的模板字段调整 subDataFor()。
const TEMPLATES = {
  payRemind: '',   // 付款提醒（发给未付款参与者）
  purchased: '',   // 已完成购买/待提货（发给所有参与者）
  arrival: '',     // 到货提货通知（发给所有参与者）
  cancel: ''       // 拼单取消（发给所有参与者）
}
const MINI_STATE = 'formal' // 体验版调试时改为 'trial'

const COLS = ['users', 'groupbuys', 'participants', 'notifications']
const readyCols = new Set()

async function ensureCol(name) {
  if (readyCols.has(name)) return
  try { await db.createCollection(name) } catch (e) { /* 已存在则忽略 */ }
  readyCols.add(name)
}

// ================= 通用小工具 =================
function fail(msg) { return { code: 1, msg } }

function assert(cond, msg) { if (!cond) throw new Error(msg) }

async function getGB(id) {
  assert(id, '缺少拼单ID')
  const res = await db.collection('groupbuys').doc(id).get().catch(() => null)
  assert(res && res.data, '拼单不存在或已被删除')
  return res.data
}

async function getParticipant(pid) {
  assert(pid, '缺少参与记录ID')
  const res = await db.collection('participants').doc(pid).get().catch(() => null)
  assert(res && res.data, '参与记录不存在')
  return res.data
}

function mustInitiator(gb, openid) {
  assert(gb.initiator_openid === openid, '只有发起人可以进行此操作')
}

/** 进行中的拼单才允许支付相关变更（已取消/已完成均不可） */
function assertActive(gb) {
  assert(['open', 'closed', 'purchased'].includes(gb.status), '拼单已结束或已取消')
}

async function participantsOf(gbId) {
  const res = await db.collection('participants')
    .where({ group_buy_id: gbId })
    .orderBy('joined_at', 'asc')
    .limit(200)
    .get()
  return res.data
}

async function addNotification(gbId, receiverOpenid, type) {
  await db.collection('notifications').add({
    data: {
      group_buy_id: gbId,
      receiver_openid: receiverOpenid,
      type,
      sent_at: Date.now()
    }
  }).catch(() => {})
}

/** 尽力发送订阅消息；未配置模板或发送失败均静默跳过 */
function buildSubData(thing1, thing2) {
  // thing 字段最长 20 字符
  return {
    thing1: { value: String(thing1 || '').slice(0, 20) },
    thing2: { value: String(thing2 || '').slice(0, 20) }
  }
}

async function sendSub(touser, key, page, thing1, thing2) {
  const templateId = TEMPLATES[key]
  if (!templateId) return
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page,
      data: buildSubData(thing1, thing2),
      miniprogramState: MINI_STATE
    })
  } catch (e) {
    console.warn('subscribe send skipped:', e.errCode || e.message)
  }
}

/** 通知拼单全部参与者：写通知记录 + 尽力发订阅消息 */
async function notifyAllParticipants(gb, type, subKey, thing2) {
  const ps = await participantsOf(gb._id)
  const openids = [...new Set(ps.map(p => p.user_openid))]
  await Promise.all(openids.map(o =>
    addNotification(gb._id, o, type).then(() =>
      sendSub(o, subKey, `pages/detail/detail?id=${gb._id}`, gb.product_name, thing2)
    )
  ))
  return openids.length
}

async function upsertUser(openid, patch) {
  const data = { updated_at: Date.now() }
  if (patch.nickname) data.nickname = patch.nickname
  if (patch.avatar) data.avatar = patch.avatar
  const exist = await db.collection('users').where({ openid }).get()
  if (exist.data.length) {
    await db.collection('users').doc(exist.data[0]._id).update({ data })
  } else {
    await db.collection('users').add({
      data: Object.assign({
        openid,
        nickname: `邻居${openid.slice(-4)}`,
        avatar: '',
        created_at: Date.now()
      }, data)
    })
  }
}

/** 云存储 fileID -> 临时链接映射（fileID 过期需要换链，非云文件原样跳过） */
async function tempUrlMap(fileIDs) {
  const ids = [...new Set((fileIDs || []).filter(x => x && /^cloud:\/\//.test(x)))]
  if (!ids.length) return {}
  const res = await cloud.getTempFileURL({ fileList: ids }).catch(() => ({ fileList: [] }))
  const map = {}
  ;(res.fileList || []).forEach(f => { if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL })
  return map
}

// ================= 定时截单 =================
async function autoCloseExpired() {
  const now = Date.now()
  const res = await db.collection('groupbuys')
    .where({ status: 'open', deadline: _.lte(now) })
    .limit(100)
    .get()
  let closed = 0
  for (const gb of res.data) {
    const u = await db.collection('groupbuys')
      .where({ _id: gb._id, status: 'open' })
      .update({ data: { status: 'closed' } })
    if (u.stats && u.stats.updated > 0) {
      closed++
      await addNotification(gb._id, gb.initiator_openid, 'deadline')
      await sendSub(gb.initiator_openid, 'purchased', `pages/manage/manage?id=${gb._id}`,
        gb.product_name, '拼单已到截单时间，请查看收款并安排购买')
    }
  }
  return { checked: res.data.length, closed }
}

// ================= Action 实现 =================
const actions = {

  /** 获取/初始化当前用户名片 */
  async getProfile(_event, openid) {
    const exist = await db.collection('users').where({ openid }).get()
    if (exist.data.length) return exist.data[0]
    const user = {
      openid,
      nickname: `邻居${openid.slice(-4)}`,
      avatar: '',
      created_at: Date.now(),
      updated_at: Date.now()
    }
    await db.collection('users').add({ data: user })
    return user
  },

  /** 更新昵称头像 */
  async updateProfile(event, openid) {
    await upsertUser(openid, event)
    return { ok: true }
  },

  /** 创建拼单 */
  async createGroupBuy(event, openid) {
    const p = event.payload || {}
    const n = normalizeBuyPayload(p)
    // 发起人自留份数：计入已拼份数，不生成收款记录
    const initiator_shares = Math.round(Number(p.initiator_shares)) || 0
    assert(Number.isInteger(initiator_shares) && initiator_shares >= 0 && initiator_shares <= n.total_shares, '自留份数无效')
    const nickname = (p.nickname || '').trim().slice(0, 16) || `邻居${openid.slice(-4)}`
    await upsertUser(openid, { nickname, avatar: p.avatar })
    const add = await db.collection('groupbuys').add({
      data: Object.assign({
        initiator_openid: openid,
        initiator_nickname: nickname,
        initiator_avatar: p.avatar || '',
        initiator_shares,
        sold_shares: initiator_shares,
        status: 'open',
        created_at: Date.now()
      }, n)
    })
    return { id: add._id }
  },

  /** 编辑拼单（仅"拼单中"）：保存后按新单价/费用重算所有参与记录的应付金额 */
  async updateGroupBuy(event, openid) {
    const gb = await getGB(event.id)
    mustInitiator(gb, openid)
    assert(gb.status === 'open', '拼单已截单，不能再编辑')
    const p = event.payload || {}
    const n = normalizeBuyPayload(p)
    const initiator_shares = Math.round(Number(p.initiator_shares)) || 0
    assert(Number.isInteger(initiator_shares) && initiator_shares >= 0, '自留份数无效')
    // 总份数缩小不能低于：邻居已拼 + 新自留
    const soldByOthers = (gb.sold_shares || 0) - (gb.initiator_shares || 0)
    assert(initiator_shares + soldByOthers <= n.total_shares,
      `总份数不足以容纳邻居已拼的 ${soldByOthers} 份，请调大总包数或减少自留`)
    const data = Object.assign({}, n, {
      initiator_shares,
      sold_shares: initiator_shares + soldByOthers,
      initiator_avatar: p.avatar || gb.initiator_avatar || ''
    })
    const nickname = (p.nickname || '').trim().slice(0, 16)
    if (nickname) {
      data.initiator_nickname = nickname
      await upsertUser(openid, { nickname, avatar: p.avatar })
    }
    await db.collection('groupbuys').doc(gb._id).update({ data })
    // 价格或费用变化时重算应付金额（支付状态保持不变）
    // 已付款记录（paid_pending/confirmed）不重算：款项已实际易手，
    // 改动会导致"实收金额与账面记录不符"，只能跳过并提示线下协商差额
    const ps = await participantsOf(gb._id)
    let changed = 0
    let skipped_paid = 0
    for (const x of ps) {
      const amount = x.shares * (n.unit_price + n.fee_express_per_share + n.fee_package_per_share)
      if (amount === x.amount_due) continue
      if (['paid_pending', 'confirmed'].includes(x.pay_status)) { skipped_paid++; continue }
      await db.collection('participants').doc(x._id).update({ data: { amount_due: amount } })
      changed++
    }
    return {
      changed_amounts: changed,
      skipped_paid,
      skip_warning: skipped_paid
        ? `有 ${skipped_paid} 条已付款记录未按新价重算，请线下与邻居协商差额`
        : ''
    }
  },

  /** 移除参与者（仅"拼单中"）：事务内删除记录并回减已拼份数 */
  async removeParticipant(event, openid) {
    const p = await getParticipant(event.participant_id)
    const gb = await getGB(p.group_buy_id)
    mustInitiator(gb, openid)
    assert(gb.status === 'open', '拼单已截单，无法移除参与者')
    const result = await db.runTransaction(async t => {
      const res = await t.collection('participants').doc(p._id).get()
      assert(res && res.data, '该参与记录不存在')
      const gbRes = await t.collection('groupbuys').doc(gb._id).get()
      assert(gbRes.data && gbRes.data.status === 'open', '拼单已截单，无法移除参与者')
      await t.collection('participants').doc(p._id).remove()
      await t.collection('groupbuys').doc(gb._id).update({
        data: { sold_shares: _.inc(-res.data.shares) }
      })
      return { removed_shares: res.data.shares }
    })
    await addNotification(gb._id, p.user_openid, 'removed')
    return result
  },

  /** 拼单详情（含参与者；支付明细仅发起人可见） */
  async getGroupBuy(event, openid) {
    const gb = await getGB(event.id)
    const ps = await participantsOf(gb._id)
    const isInitiator = gb.initiator_openid === openid
    const mine = ps.find(x => x.user_openid === openid) || null

    const urlMap = await tempUrlMap([
      gb.product_image, gb.pay_qr_url, gb.initiator_avatar, ...ps.map(x => x.avatar)
    ])

    const group_buy = Object.assign({}, gb, {
      product_image_url: urlMap[gb.product_image] || '',
      pay_qr_temp_url: urlMap[gb.pay_qr_url] || '',
      initiator_avatar_url: urlMap[gb.initiator_avatar] || ''
    })

    // 团长自留份数以合成行插在名单最前（无收款记录，不参与金额汇总）
    const participants = []
    if ((gb.initiator_shares || 0) > 0) {
      participants.push({
        _id: 'initiator',
        is_initiator_row: true,
        nickname: gb.initiator_nickname,
        avatar_url: urlMap[gb.initiator_avatar] || '',
        shares: gb.initiator_shares,
        joined_at: gb.created_at
      })
    }
    ps.forEach(x => {
      const base = {
        _id: x._id,
        nickname: x.nickname,
        avatar_url: urlMap[x.avatar] || '',
        shares: x.shares,
        joined_at: x.joined_at,
        pickup_status: x.pickup_status
      }
      if (isInitiator) {
        // 发起人可见支付明细；普通成员仅见昵称与份数
        participants.push(Object.assign(base, {
          user_openid: x.user_openid,
          amount_due: x.amount_due,
          pay_method: x.pay_method,
          pay_status: x.pay_status,
          paid_at: x.paid_at,
          confirmed_at: x.confirmed_at,
          payment_note: x.payment_note
        }))
      } else {
        participants.push(base)
      }
    })

    return {
      group_buy,
      participants,
      is_initiator: isInitiator,
      my_participant: mine ? {
        _id: mine._id,
        shares: mine.shares,
        amount_due: mine.amount_due,
        pay_method: mine.pay_method,
        pay_status: mine.pay_status,
        paid_at: mine.paid_at,
        confirmed_at: mine.confirmed_at,
        payment_note: mine.payment_note,
        pickup_status: mine.pickup_status
      } : null
    }
  },

  /**
   * 加入拼单（事务防超卖）。
   * 参与记录 _id 使用 `拼单ID_openid`，天然保证一人一单，重复加入直接命中唯一键冲突。
   */
  async joinGroupBuy(event, openid) {
    const id = event.id
    const shares = Math.round(Number(event.shares))
    assert(Number.isInteger(shares) && shares >= 1, '请选择有效的份额')
    const gb0 = await getGB(id)
    if (gb0.status !== 'open' || Date.now() >= gb0.deadline) {
      throw new Error('拼单已截单，无法加入')
    }
    assert(gb0.initiator_openid !== openid, '不能参与自己发起的拼单')

    const nickname = (event.nickname || '').trim().slice(0, 16) || `邻居${openid.slice(-4)}`
    await upsertUser(openid, { nickname, avatar: event.avatar })

    const pid = `${id}_${openid}`
    try {
      return await db.runTransaction(async t => {
        let gb
        try {
          const res = await t.collection('groupbuys').doc(id).get()
          gb = res.data
        } catch (e) {
          throw new Error('拼单不存在')
        }
        assert(gb.status === 'open', '拼单已截单，无法加入')
        assert(Date.now() < gb.deadline, '拼单已到截单时间，无法加入')
        assert(gb.total_shares - gb.sold_shares >= shares, '剩余份数不足，请调整份额')

        const amount_due = shares * (gb.unit_price + (gb.fee_express_per_share || 0) + (gb.fee_package_per_share || 0))
        await t.collection('participants').add({
          data: {
            _id: pid,
            group_buy_id: id,
            user_openid: openid,
            nickname,
            avatar: event.avatar || '',
            shares,
            amount_due,
            pay_method: null,
            pay_status: 'unpaid',
            paid_at: null,
            confirmed_at: null,
            payment_note: '',
            pickup_status: 'pending',
            joined_at: Date.now()
          }
        })
        await t.collection('groupbuys').doc(id).update({
          data: { sold_shares: _.inc(shares) }
        })
        return { participant_id: pid, amount_due, shares }
      })
    } catch (e) {
      const msg = String((e && (e.errMsg || e.message)) || '')
      if (/-502001|exist|duplicate/i.test(msg)) {
        throw new Error('您已参与该拼单，请到"我的订单"查看')
      }
      throw e
    }
  },

  /** 参与者选择支付方式 */
  async choosePayMethod(event, openid) {
    const p = await getParticipant(event.participant_id)
    assert(p.user_openid === openid, '只能操作自己的参与记录')
    const gb = await getGB(p.group_buy_id)
    assertActive(gb)
    assert(p.pay_status === 'unpaid', '当前状态不可更改支付方式')

    if (event.method === 'cash') {
      assert(gb.pay_cash_enabled, '发起人未开启当面支付')
      await db.collection('participants').doc(p._id).update({
        data: { pay_method: 'cash', pay_status: 'cash_on_pickup' }
      })
    } else if (event.method === 'qr_code') {
      assert(gb.pay_qr_enabled, '发起人未开启收款码支付')
      await db.collection('participants').doc(p._id).update({
        data: { pay_method: 'qr_code' }
      })
    } else {
      throw new Error('无效的支付方式')
    }
    return { ok: true }
  },

  /** 参与者标记"我已付款"（走收款码转账后） */
  async markPaid(event, openid) {
    const p = await getParticipant(event.participant_id)
    assert(p.user_openid === openid, '只能操作自己的参与记录')
    const gb = await getGB(p.group_buy_id)
    assertActive(gb)
    if (p.pay_status === 'paid_pending') throw new Error('已标记付款，等待发起人确认')
    assert(p.pay_status === 'unpaid', '当前状态不可标记付款')
    // 未显式选择方式时，点"我已付款"视为收款码方式
    const method = p.pay_method || (gb.pay_qr_enabled ? 'qr_code' : null)
    assert(method === 'qr_code', '请先选择支付方式')

    await db.collection('participants').doc(p._id).update({
      data: {
        pay_method: 'qr_code',
        pay_status: 'paid_pending',
        paid_at: Date.now(),
        payment_note: String(event.payment_note || '').slice(0, 40)
      }
    })
    return { ok: true }
  },

  /** 发起人确认单笔收款 */
  async confirmPay(event, openid) {
    const p = await getParticipant(event.participant_id)
    const gb = await getGB(p.group_buy_id)
    mustInitiator(gb, openid)
    assertActive(gb)
    assert(p.pay_status === 'paid_pending', '该记录不是"待确认"状态')
    await db.collection('participants').doc(p._id).update({
      data: { pay_status: 'confirmed', confirmed_at: Date.now() }
    })
    return { ok: true }
  },

  /** 发起人一键确认全部待确认记录 */
  async confirmAllPay(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assertActive(gb)
    const res = await db.collection('participants')
      .where({ group_buy_id: gb._id, pay_status: 'paid_pending' })
      .update({ data: { pay_status: 'confirmed', confirmed_at: Date.now() } })
    return { updated: (res.stats && res.stats.updated) || 0 }
  },

  /** 发起人标记未收到款 -> 退回待付款 */
  async rejectPay(event, openid) {
    const p = await getParticipant(event.participant_id)
    const gb = await getGB(p.group_buy_id)
    mustInitiator(gb, openid)
    assertActive(gb)
    assert(p.pay_status === 'paid_pending', '该记录不是"待确认"状态')
    await db.collection('participants').doc(p._id).update({
      data: {
        pay_status: 'unpaid',
        paid_at: _.remove(),
        payment_note: _.remove()
      }
    })
    return { ok: true }
  },

  /** 发起人当面收款确认（cash_on_pickup 或提货时收了未付款者的现金） */
  async confirmCash(event, openid) {
    const p = await getParticipant(event.participant_id)
    const gb = await getGB(p.group_buy_id)
    mustInitiator(gb, openid)
    assertActive(gb)
    assert(['cash_on_pickup', 'unpaid'].includes(p.pay_status), '该记录无需当面收款确认')
    await db.collection('participants').doc(p._id).update({
      data: { pay_method: 'cash', pay_status: 'confirmed', confirmed_at: Date.now() }
    })
    return { ok: true }
  },

  /** 发起人提醒未付款者（每人每日限一次） */
  async remindPay(event, openid) {
    const p = await getParticipant(event.participant_id)
    const gb = await getGB(p.group_buy_id)
    mustInitiator(gb, openid)
    assert(p.pay_status === 'unpaid', '该邻居不在待付款状态')
    const dayAgo = Date.now() - 86400000
    const dup = await db.collection('notifications').where({
      group_buy_id: gb._id,
      receiver_openid: p.user_openid,
      type: 'pay_remind',
      sent_at: _.gte(dayAgo)
    }).count()
    assert(dup.total === 0, '该邻居 24 小时内已提醒过')
    await addNotification(gb._id, p.user_openid, 'pay_remind')
    await sendSub(p.user_openid, 'payRemind', `pages/pay/pay?id=${gb._id}`,
      gb.product_name, '您参与的拼单待付款，请尽快完成')
    return { ok: true }
  },

  /**
   * 截单。force=false 时只返回未付款统计（供弹窗确认），不执行截单。
   * N=未确认付款人数（含当面支付），M=其中选择当面支付人数。
   */
  async closeGroupBuy(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assert(gb.status === 'open', '拼单不在进行中')
    const ps = await participantsOf(gb._id)
    const unpaidCount = ps.filter(x => ['unpaid', 'paid_pending', 'cash_on_pickup'].includes(x.pay_status)).length
    const cashCount = ps.filter(x => x.pay_status === 'cash_on_pickup').length
    const stats = { unpaid_count: unpaidCount, cash_count: cashCount, total: ps.length }
    if (!event.force) return { preview: true, ...stats }

    const u = await db.collection('groupbuys')
      .where({ _id: gb._id, status: 'open' })
      .update({ data: { status: 'closed' } })
    assert(u.stats && u.stats.updated > 0, '拼单状态已变化，请刷新后重试')
    return Object.assign({ preview: false }, stats)
  },

  /** 已完成购买 -> 待提货，并通知所有参与者 */
  async markPurchased(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assert(gb.status === 'closed', '请先截单再标记完成购买')
    const u = await db.collection('groupbuys')
      .where({ _id: gb._id, status: 'closed' })
      .update({ data: { status: 'purchased' } })
    assert(u.stats && u.stats.updated > 0, '拼单状态已变化，请刷新后重试')
    const notified = await notifyAllParticipants(gb, 'purchased', 'purchased', '拼单已购买，请留意提货通知')
    return { notified }
  },

  /** 通知提货（向所有参与者推送） */
  async notifyPickup(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assert(gb.status === 'purchased', '拼单当前不在"待提货"状态')
    const notified = await notifyAllParticipants(gb, 'arrival', 'arrival',
      `已到货，请到${gb.pickup_location}找发起人提货`)
    return { notified }
  },

  /** 手动完成拼单 */
  async completeGroupBuy(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assert(gb.status === 'purchased', '拼单当前不在"待提货"状态')
    await db.collection('groupbuys')
      .where({ _id: gb._id, status: 'purchased' })
      .update({ data: { status: 'completed' } })
    return { ok: true }
  },

  /** 参与者确认提货；全员提货后自动完成拼单 */
  async confirmPickup(event, openid) {
    const p = await getParticipant(event.participant_id)
    assert(p.user_openid === openid, '只能操作自己的参与记录')
    const gb = await getGB(p.group_buy_id)
    assert(gb.status === 'purchased', '拼单当前不在"待提货"状态')
    assert(p.pickup_status === 'pending', '您已确认过提货')
    await db.collection('participants').doc(p._id).update({
      data: { pickup_status: 'picked_up' }
    })
    const rest = await db.collection('participants')
      .where({ group_buy_id: gb._id, pickup_status: 'pending' })
      .count()
    let gbCompleted = false
    if (rest.total === 0) {
      await db.collection('groupbuys')
        .where({ _id: gb._id, status: 'purchased' })
        .update({ data: { status: 'completed' } })
      gbCompleted = true
    }
    return { ok: true, gb_completed: gbCompleted }
  },

  /** 取消拼单：通知所有参与者；已付款者由 UI 提示线下联系发起人退款 */
  async cancelGroupBuy(event, openid) {
    const gb = await getGB(event.group_buy_id)
    mustInitiator(gb, openid)
    assert(['open', 'closed'].includes(gb.status), '拼单已进入购买/提货阶段，无法取消')
    const u = await db.collection('groupbuys')
      .where({ _id: gb._id, status: gb.status })
      .update({ data: { status: 'cancelled' } })
    assert(u.stats && u.stats.updated > 0, '拼单状态已变化，请刷新后重试')
    const notified = await notifyAllParticipants(gb, 'cancel', 'cancel', '拼单已取消，已付款请联系发起人退款')
    return { notified }
  },

  /** 我的参与记录（关联拼单信息） */
  async getMyOrders(_event, openid) {
    const ps = await db.collection('participants')
      .where({ user_openid: openid })
      .orderBy('joined_at', 'desc')
      .limit(50)
      .get()
    const ids = [...new Set(ps.data.map(x => x.group_buy_id))]
    const gbs = ids.length
      ? await db.collection('groupbuys').where({ _id: _.in(ids) }).get()
      : { data: [] }
    const gbById = {}
    gbs.data.forEach(g => { gbById[g._id] = g })
    const urlMap = await tempUrlMap(gbs.data.map(g => g.product_image))
    return ps.data
      .filter(x => gbById[x.group_buy_id])
      .map(x => {
        const g = gbById[x.group_buy_id]
        return {
          participant: {
            _id: x._id,
            shares: x.shares,
            amount_due: x.amount_due,
            pay_method: x.pay_method,
            pay_status: x.pay_status,
            pickup_status: x.pickup_status,
            joined_at: x.joined_at
          },
          group_buy: {
            _id: g._id,
            product_name: g.product_name,
            store: g.store,
            unit: g.unit,
            unit_price: g.unit_price,
            total_shares: g.total_shares,
            sold_shares: g.sold_shares,
            deadline: g.deadline,
            pickup_location: g.pickup_location,
            status: g.status,
            product_image_url: urlMap[g.product_image] || '',
            pay_qr_enabled: g.pay_qr_enabled,
            pay_cash_enabled: g.pay_cash_enabled
          }
        }
      })
  },

  /** 我发起的拼单（含收款汇总） */
  async getMyCreated(_event, openid) {
    const gbs = await db.collection('groupbuys')
      .where({ initiator_openid: openid })
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()
    const ids = gbs.data.map(g => g._id)
    const ps = ids.length
      ? await db.collection('participants').where({ group_buy_id: _.in(ids) }).get()
      : { data: [] }
    const byGb = {}
    ps.data.forEach(x => {
      const arr = byGb[x.group_buy_id] || (byGb[x.group_buy_id] = [])
      arr.push(x)
    })
    const urlMap = await tempUrlMap(gbs.data.map(g => g.product_image))
    return gbs.data.map(g => {
      const list = byGb[g._id] || []
      const sum = st => list.filter(x => x.pay_status === st)
        .reduce((s, x) => s + (x.amount_due || 0), 0)
      return {
        _id: g._id,
        product_name: g.product_name,
        store: g.store,
        unit: g.unit,
        unit_price: g.unit_price,
        total_shares: g.total_shares,
        sold_shares: g.sold_shares,
        deadline: g.deadline,
        status: g.status,
        created_at: g.created_at,
        product_image_url: urlMap[g.product_image] || '',
        participant_count: list.length,
        confirmed_amount: sum('confirmed'),
        pending_amount: sum('paid_pending'),
        unpaid_count: list.filter(x => x.pay_status === 'unpaid').length,
        cash_count: list.filter(x => x.pay_status === 'cash_on_pickup').length
      }
    })
  },

  /** 发现页：全部进行中的拼单（按截单时间升序）+ 我的参与/发起标记 */
  async listDiscover(_event, openid) {
    const gbs = await db.collection('groupbuys')
      .where({ status: 'open' })
      .orderBy('deadline', 'asc')
      .limit(50)
      .get()
    const ids = gbs.data.map(g => g._id)
    const ps = ids.length
      ? await db.collection('participants').where({ group_buy_id: _.in(ids) }).get()
      : { data: [] }
    const counts = {}
    const joinedSet = new Set()
    ps.data.forEach(x => {
      counts[x.group_buy_id] = (counts[x.group_buy_id] || 0) + 1
      if (x.user_openid === openid) joinedSet.add(x.group_buy_id)
    })
    const urlMap = await tempUrlMap(gbs.data.map(g => g.product_image))
    return {
      openid,
      joined_ids: [...joinedSet],
      list: gbs.data.map(g => ({
        _id: g._id,
        product_name: g.product_name,
        store: g.store,
        unit: g.unit,
        unit_price: g.unit_price,
        total_shares: g.total_shares,
        sold_shares: g.sold_shares,
        deadline: g.deadline,
        pickup_location: g.pickup_location,
        initiator_nickname: g.initiator_nickname,
        initiator_openid: g.initiator_openid,
        image_url: urlMap[g.product_image] || '',
        participant_count: counts[g._id] || 0
      }))
    }
  }
}

function pay_fee_amount(v) {
  const n = Math.round(Number(v))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** 校验并规范化创建/编辑拼单的公共字段（金额单位：分） */
function normalizeBuyPayload(p) {
  assert(p.product_name && String(p.product_name).trim(), '请填写商品名称')
  const package_price = Math.round(Number(p.package_price))
  assert(Number.isInteger(package_price) && package_price > 0, '整包价格无效')
  const package_shares = Math.round(Number(p.package_shares))
  assert(Number.isInteger(package_shares) && package_shares >= 1 && package_shares <= 999, '每包拆分数量需为 1-999')
  const total_packages = Math.round(Number(p.total_packages)) || 1
  assert(Number.isInteger(total_packages) && total_packages >= 1 && total_packages <= 99, '总包数需为 1-99')
  const total_shares = package_shares * total_packages
  // 每份单价 = 整包价格 ÷ 每包拆分数量（四舍五入到分，尾差由发起人吸收）
  const unit_price = Math.round(package_price / package_shares)
  const deadline = Number(p.deadline)
  assert(deadline > Date.now() + 60000, '截单时间需晚于当前时间')
  const pay_qr_enabled = !!p.pay_qr_enabled
  const pay_cash_enabled = !!p.pay_cash_enabled
  assert(pay_qr_enabled || pay_cash_enabled, '至少开启一种收款方式')
  assert(!pay_qr_enabled || p.pay_qr_url, '开启收款码需上传收款码图片')
  const fee_bearer = ['split', 'initiator', 'none'].includes(p.fee_bearer) ? p.fee_bearer : 'split'
  const express_fee = pay_fee_amount(p.express_fee)
  const package_fee = pay_fee_amount(p.package_fee)
  // 均摊到每份：四舍五入到分（元两位小数），极小尾差由发起人吸收
  return {
    store: String(p.store || '其他').slice(0, 12),
    product_name: String(p.product_name).trim().slice(0, 30),
    product_image: p.product_image || '',
    unit: String(p.unit || '份').slice(0, 4),
    unit_price,
    total_shares,
    package_price,
    package_shares,
    total_packages,
    express_fee,
    package_fee,
    fee_bearer,
    fee_express_per_share: fee_bearer === 'split' ? Math.round(express_fee / total_shares) : 0,
    fee_package_per_share: fee_bearer === 'split' ? Math.round(package_fee / total_shares) : 0,
    deadline,
    pickup_location: String(p.pickup_location || '').trim().slice(0, 40) || '小区门口',
    remark: String(p.remark || '').slice(0, 200),
    pay_qr_enabled,
    pay_qr_url: p.pay_qr_url || '',
    pay_qr_note: String(p.pay_qr_note || '').slice(0, 60),
    pay_cash_enabled
  }
}

// ================= 入口 =================
exports.main = async (event = {}) => {
  // 定时触发器：每 5 分钟检查到期拼单并自动截单
  if (event.Type === 'Timer' || event.TriggerName) {
    try { return { code: 0, data: await autoCloseExpired() } }
    catch (e) { console.error('autoClose failed', e); return fail('自动截单失败：' + e.message) }
  }

  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('无用户身份，请从小程序端调用')
  await Promise.all(COLS.map(ensureCol))

  const fn = actions[event.action]
  if (!fn) return fail('未知的 action：' + event.action)
  try {
    const data = await fn(event, OPENID)
    return { code: 0, data }
  } catch (e) {
    console.error(`action ${event.action} failed:`, e)
    return fail(e.message || '服务异常，请稍后重试')
  }
}
