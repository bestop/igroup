/**
 * 拼单域：创建/编辑/详情/状态流转（截单、购买、提货通知、完成、取消）
 */
const { db, participantsOf, getGB } = require('../lib/db')
const { assert, mustInitiator } = require('../lib/guards')
const { normalizeBuyPayload } = require('../lib/normalize')
const { upsertUser } = require('../lib/user')
const { notifyAllParticipants, tempUrlMap } = require('../lib/notify')

/** 创建拼单 */
async function createGroupBuy(event, openid) {
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
}

/** 编辑拼单（仅"拼单中"）：保存后按新单价/费用重算所有参与记录的应付金额 */
async function updateGroupBuy(event, openid) {
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
}

/** 拼单详情（含参与者；支付明细仅发起人可见） */
async function getGroupBuy(event, openid) {
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
}

/**
 * 截单。force=false 时只返回未付款统计（供弹窗确认），不执行截单。
 * N=未确认付款人数（含当面支付），M=其中选择当面支付人数。
 */
async function closeGroupBuy(event, openid) {
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
}

/** 已完成购买 -> 待提货，并通知所有参与者 */
async function markPurchased(event, openid) {
  const gb = await getGB(event.group_buy_id)
  mustInitiator(gb, openid)
  assert(gb.status === 'closed', '请先截单再标记完成购买')
  const u = await db.collection('groupbuys')
    .where({ _id: gb._id, status: 'closed' })
    .update({ data: { status: 'purchased' } })
  assert(u.stats && u.stats.updated > 0, '拼单状态已变化，请刷新后重试')
  const notified = await notifyAllParticipants(gb, 'purchased', 'purchased', '拼单已购买，请留意提货通知')
  return { notified }
}

/** 通知提货（向所有参与者推送） */
async function notifyPickup(event, openid) {
  const gb = await getGB(event.group_buy_id)
  mustInitiator(gb, openid)
  assert(gb.status === 'purchased', '拼单当前不在"待提货"状态')
  const notified = await notifyAllParticipants(gb, 'arrival', 'arrival',
    `已到货，请到${gb.pickup_location}找发起人提货`)
  return { notified }
}

/** 手动完成拼单 */
async function completeGroupBuy(event, openid) {
  const gb = await getGB(event.group_buy_id)
  mustInitiator(gb, openid)
  assert(gb.status === 'purchased', '拼单当前不在"待提货"状态')
  await db.collection('groupbuys')
    .where({ _id: gb._id, status: 'purchased' })
    .update({ data: { status: 'completed' } })
  return { ok: true }
}

/** 取消拼单：通知所有参与者；已付款者由 UI 提示线下联系发起人退款 */
async function cancelGroupBuy(event, openid) {
  const gb = await getGB(event.group_buy_id)
  mustInitiator(gb, openid)
  assert(['open', 'closed'].includes(gb.status), '拼单已进入购买/提货阶段，无法取消')
  const u = await db.collection('groupbuys')
    .where({ _id: gb._id, status: gb.status })
    .update({ data: { status: 'cancelled' } })
  assert(u.stats && u.stats.updated > 0, '拼单状态已变化，请刷新后重试')
  const notified = await notifyAllParticipants(gb, 'cancel', 'cancel', '拼单已取消，已付款请联系发起人退款')
  return { notified }
}

module.exports = {
  createGroupBuy, updateGroupBuy, getGroupBuy, closeGroupBuy,
  markPurchased, notifyPickup, completeGroupBuy, cancelGroupBuy
}
