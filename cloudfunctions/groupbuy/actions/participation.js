/**
 * 参与域：加入拼单（事务防超卖）、移除参与者、确认提货
 */
const { db, _, getGB, getParticipant } = require('../lib/db')
const { assert, mustInitiator } = require('../lib/guards')
const { upsertUser } = require('../lib/user')
const { addNotification } = require('../lib/notify')

/**
 * 加入拼单（事务防超卖）。
 * 参与记录 _id 使用 `拼单ID_openid`，天然保证一人一单，重复加入直接命中唯一键冲突。
 */
async function joinGroupBuy(event, openid) {
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
}

/** 移除参与者（仅"拼单中"）：事务内删除记录并回减已拼份数 */
async function removeParticipant(event, openid) {
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
}

/** 参与者确认提货；全员提货后自动完成拼单 */
async function confirmPickup(event, openid) {
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
}

module.exports = { joinGroupBuy, removeParticipant, confirmPickup }
