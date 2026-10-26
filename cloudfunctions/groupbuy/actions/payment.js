/**
 * 收款域：支付方式选择、付款标记、收款确认/驳回、当面收款、付款提醒
 * 资金原则：本模块不触碰任何资金，只做记账 + 状态协同。
 */
const { db, _, getGB, getParticipant } = require('../lib/db')
const { assert, mustInitiator, assertActive } = require('../lib/guards')
const { addNotification, sendSub } = require('../lib/notify')

/** 参与者选择支付方式 */
async function choosePayMethod(event, openid) {
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
}

/** 参与者标记"我已付款"（走收款码转账后） */
async function markPaid(event, openid) {
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
}

/** 发起人确认单笔收款 */
async function confirmPay(event, openid) {
  const p = await getParticipant(event.participant_id)
  const gb = await getGB(p.group_buy_id)
  mustInitiator(gb, openid)
  assertActive(gb)
  assert(p.pay_status === 'paid_pending', '该记录不是"待确认"状态')
  await db.collection('participants').doc(p._id).update({
    data: { pay_status: 'confirmed', confirmed_at: Date.now() }
  })
  return { ok: true }
}

/** 发起人一键确认全部待确认记录 */
async function confirmAllPay(event, openid) {
  const gb = await getGB(event.group_buy_id)
  mustInitiator(gb, openid)
  assertActive(gb)
  const res = await db.collection('participants')
    .where({ group_buy_id: gb._id, pay_status: 'paid_pending' })
    .update({ data: { pay_status: 'confirmed', confirmed_at: Date.now() } })
  return { updated: (res.stats && res.stats.updated) || 0 }
}

/** 发起人标记未收到款 -> 退回待付款 */
async function rejectPay(event, openid) {
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
}

/** 发起人当面收款确认（cash_on_pickup 或提货时收了未付款者的现金） */
async function confirmCash(event, openid) {
  const p = await getParticipant(event.participant_id)
  const gb = await getGB(p.group_buy_id)
  mustInitiator(gb, openid)
  assertActive(gb)
  assert(['cash_on_pickup', 'unpaid'].includes(p.pay_status), '该记录无需当面收款确认')
  await db.collection('participants').doc(p._id).update({
    data: { pay_method: 'cash', pay_status: 'confirmed', confirmed_at: Date.now() }
  })
  return { ok: true }
}

/** 发起人提醒未付款者（每人每日限一次） */
async function remindPay(event, openid) {
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
}

module.exports = { choosePayMethod, markPaid, confirmPay, confirmAllPay, rejectPay, confirmCash, remindPay }
