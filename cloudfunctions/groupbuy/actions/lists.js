/**
 * 列表域：我的订单 / 我发起的 / 发现页
 */
const { _, fetchAll } = require('../lib/db')
const { tempUrlMap } = require('../lib/notify')

/** 我的参与记录（关联拼单信息） */
async function getMyOrders(_event, openid) {
  const ps = await fetchAll('participants', { user_openid: openid }, ['joined_at', 'desc'])
  const ids = [...new Set(ps.map(x => x.group_buy_id))]
  const gbs = ids.length
    ? await fetchAll('groupbuys', { _id: _.in(ids) }, ['_id', 'asc'])
    : []
  const gbById = {}
  gbs.forEach(g => { gbById[g._id] = g })
  const urlMap = await tempUrlMap(gbs.map(g => g.product_image))
  return ps
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
}

/** 我发起的拼单（含收款汇总） */
async function getMyCreated(_event, openid) {
  const gbs = await fetchAll('groupbuys', { initiator_openid: openid }, ['created_at', 'desc'])
  const ids = gbs.map(g => g._id)
  const ps = ids.length
    ? await fetchAll('participants', { group_buy_id: _.in(ids) }, ['_id', 'asc'])
    : []
  const byGb = {}
  ps.forEach(x => {
    const arr = byGb[x.group_buy_id] || (byGb[x.group_buy_id] = [])
    arr.push(x)
  })
  const urlMap = await tempUrlMap(gbs.map(g => g.product_image))
  return gbs.map(g => {
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
}

/** 发现页：全部进行中的拼单（按截单时间升序）+ 我的参与/发起标记 */
async function listDiscover(_event, openid) {
  const gbs = await fetchAll('groupbuys', { status: 'open' }, ['deadline', 'asc'])
  const ids = gbs.map(g => g._id)
  const ps = ids.length
    ? await fetchAll('participants', { group_buy_id: _.in(ids) }, ['_id', 'asc'])
    : []
  const counts = {}
  const joinedSet = new Set()
  ps.forEach(x => {
    counts[x.group_buy_id] = (counts[x.group_buy_id] || 0) + 1
    if (x.user_openid === openid) joinedSet.add(x.group_buy_id)
  })
  const urlMap = await tempUrlMap(gbs.map(g => g.product_image))
  return {
    openid,
    joined_ids: [...joinedSet],
    list: gbs.map(g => ({
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

module.exports = { getMyOrders, getMyCreated, listDiscover }
